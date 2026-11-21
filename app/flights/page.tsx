"use client";
import { airportLabel, describeRoute } from "@/lib/flight-route-display";

import { loginUrl } from "@/app/lib/return-path";

import { acknowledgeBooking, bookingRequest } from "@/app/lib/booking-request";
import { getAccessToken, sessionFetch, recoverSession } from "@/app/lib/session";

import LocationCombobox from "@/app/components/LocationCombobox";
import BookingSteps from "@/app/components/BookingSteps";
import ReservationSuccess from "@/app/components/ReservationSuccess";
import { flightSearchPath, readFlightSearch, type FlightSearch } from "@/app/lib/flight-search";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAccessToken } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

// One flight leg, as returned by the flight search endpoint.
interface Flight {
    id: string;
    flightNumber?: string;
    /**
     * ISO-8601 departure and arrival timestamps.
     *
     * Optional on the type because the page renders "N/A" for a leg the provider
     * described only partially — but every leg of a connecting itinerary has
     * both, and they are what decides whether two legs can be one booking
     * (`bookingBlocker`).
     */
    departureTime?: string;
    arrivalTime?: string;
    price: number;
    /**
     * Block time in minutes. `GET /api/flights/search` normalises every leg to
     * this numeric field, so it is what the page formats and sums. It stays
     * optional only because a leg without a usable duration is rendered as
     * "N/A" rather than as arithmetic on `undefined`.
     */
    durationMinutes?: number;
    availableSeats?: number;
    airline?: {
        code: string;
        name: string;
    };
    origin?: {
        code: string;
        name: string;
        city: string;
        country: string;
    };
    destination?: {
        code: string;
        name: string;
        city: string;
        country: string;
    };
}

// Define FlightGroup interface for grouped flights (direct or connecting)
interface FlightGroup {
    legs: number;
    flights: Flight[];
    totalPrice?: number;
    totalDuration?: number;
}

const flightClock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const flightDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Summarize just one direction so a round-trip destination never appears as a layover. */
function searchRoute(flights: Flight[]) {
    return describeRoute(undefined, undefined, flights.map(({ origin, destination }) => ({
        from: origin?.code, originCity: origin?.city, to: destination?.code, destinationCity: destination?.city,
    })));
}

function routeText(flights: Flight[]): string {
    const { from, to, stops } = searchRoute(flights);
    return from + " → " + to + (stops.length ? " via " + stops.join(" → ") : "");
}

function SchedulePoint({ stamp, airport }: { stamp?: string; airport?: string }) {
    const date = stamp ? new Date(stamp) : null;
    const known = date && Number.isFinite(date.getTime());
    return <div className="schedule-point">
        <time dateTime={known ? stamp : undefined}>{known ? flightClock.format(date) : "—"}</time>
        <span>{airport ?? "—"}{known && <> · <span className="whitespace-nowrap">{flightDay.format(date)}</span></>}</span>
    </div>;
}

/**
 * Format a duration in minutes as `Xh Ym`.
 *
 * Guarded rather than trusting the caller: a non-finite value renders
 * "NaNh NaNm", which is what this page showed while the search endpoint was
 * returning AFS's ISO-8601 `duration` string in this position.
 */
const formatDuration = (minutes: number): string => {
    if (!Number.isFinite(minutes) || minutes < 0) {
        return "N/A";
    }
    const whole = Math.round(minutes);
    // Floored, not rounded: rounding the remainder lets 119 minutes render as
    // "1h 60m" instead of "2h 0m".
    const hours = Math.floor(whole / 60);
    const mins = whole % 60;
    return `${hours}h ${mins}m`;
};

/** `1` leg is a direct flight; anything longer is one stop per extra leg. */
const stopsLabel = (legs: number): string => {
    const stops = legs - 1;
    if (stops <= 0) {
        return "Direct Flight";
    }
    return `${stops} Stop${stops > 1 ? "s" : ""}`;
};

/** The traveller's name for a day, so a next-day connection is not a surprise. */
const dayLabel = (value?: string): string => {
    if (!value) {
        return "the next day";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "the next day";
    }
    return date.toLocaleDateString("en-US");
};

/** Local `YYYY-MM-DD`, which is what an `<input type="date">` min expects. */
const localDay = (date: Date): string => {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

/**
 * The earliest return date for an outbound on `date`.
 *
 * The day after the outbound, not the same day: both halves ride on one ticket,
 * so the return has to leave after the outbound arrives, and a same-day return
 * cannot be the same booking. Offered as the input's `min` so the rule is visible
 * while the date is being picked.
 */
const earliestReturnDay = (date: string): string => {
    const base = date ? new Date(`${date}T00:00:00`) : new Date();
    if (Number.isNaN(base.getTime())) {
        return localDay(new Date());
    }
    base.setDate(base.getDate() + 1);
    return localDay(base);
};

/**
 * How many minutes `next` leaves after `previous` lands, or `null` when either
 * timestamp is missing or unusable — a partial leg, not a negative layover.
 */
const legLayoverMinutes = (previous: Flight, next: Flight): number | null => {
    if (!previous.arrivalTime || !next.departureTime) {
        return null;
    }
    const arrival = new Date(previous.arrivalTime).getTime();
    const departure = new Date(next.departureTime).getTime();
    if (Number.isNaN(arrival) || Number.isNaN(departure)) {
        return null;
    }
    return Math.round((departure - arrival) / 60_000);
};

/**
 * The time two legs of one booking must leave between them, in minutes.
 *
 * The provider enforces it on both ends — `GET /api/flights` never offers a
 * connection with less, and `POST /api/bookings` refuses one — so the page has to
 * agree with it. Anything below this is not a tight connection, it is a booking
 * the airline will reject.
 */
const MINIMUM_LAYOVER_MINUTES = 60;

/**
 * Why `flights` cannot be bought as one ticket, or `null` when it can: every leg
 * has to leave after the one before it lands, with at least
 * {@link MINIMUM_LAYOVER_MINUTES} on the ground.
 *
 * The provider validates exactly this, so sending a payload that fails it earns a
 * `400` — either "Flights are not consecutive in sequence" or a message about the
 * two flights being less than an hour apart. Neither says which selection was
 * wrong, so the check is repeated here where the page can name it.
 */
const bookingBlocker = (flights: Flight[]): string | null => {
    for (let index = 1; index < flights.length; index += 1) {
        const layover = legLayoverMinutes(flights[index - 1], flights[index]);
        // An unparseable timestamp is not evidence of an overlap: the request is
        // sent and the provider's own validation decides.
        if (layover === null || layover >= MINIMUM_LAYOVER_MINUTES) {
            continue;
        }
        if (layover < 0) {
            return "These flights cannot be booked as one trip, because the later flight leaves before the earlier one arrives. Choose a return that departs after all the outbound legs have landed — a return on the same day cannot be part of the same booking.";
        }
        return `These flights cannot be booked as one trip, because the connection at ${airportLabel(flights[index].origin?.code, flights[index].origin?.city)} leaves less than an hour after the previous leg lands. Choose a different connection.`;
    }
    return null;
};

/**
 * The words a traveller needs between two legs of one itinerary: where they
 * wait, how long for, and — for a connection that lands on the next day — when
 * the onward flight actually leaves.
 */
const layoverLabel = (previous: Flight, next: Flight): string => {
    const where = `Layover at ${airportLabel(next.origin?.code ?? previous.destination?.code, next.origin?.city ?? previous.destination?.city)}`;
    const minutes = legLayoverMinutes(previous, next);
    const duration = minutes === null ? "" : ` · ${formatDuration(minutes)}`;
    const crossesDay =
        previous.arrivalTime &&
        next.departureTime &&
        new Date(previous.arrivalTime).toDateString() !==
            new Date(next.departureTime).toDateString();
    const departure = crossesDay ? ` · departs ${dayLabel(next.departureTime)}` : "";
    return where + duration + departure;
};

const generateGroupId = (flights: Flight[]) => {
    return flights.map((f) => f.id).join("|");
};

export default function FlightSearchPage() {
    const router = useRouter();
    const [tripType, setTripType] = useState<"one-way" | "round-trip">("one-way");

    // Outbound search fields.
    const [origin, setOrigin] = useState("");
    const [destination, setDestination] = useState("");
    const [date, setDate] = useState("");

    // Return search field (for round-trip).
    const [returnDate, setReturnDate] = useState("");
    const [deviceTimeZone, setDeviceTimeZone] = useState("");
    useEffect(() => {
        setDeviceTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }, []);
    const signInForSelection = () => loginUrl(flightSearchPath({ ...searchDetails, tripType }));




    // Flight results for outbound and return.
    const [outboundFlightGroups, setOutboundFlightGroups] = useState<FlightGroup[]>([]);
    const [returnFlightGroups, setReturnFlightGroups] = useState<FlightGroup[]>([]);
    const [activeDirection, setActiveDirection] = useState<"outbound" | "return">("outbound");
    const [searchDetails, setSearchDetails] = useState({ origin: "", destination: "", date: "", returnDate: "" });
    const resultsRef = useRef<HTMLDivElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);

    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [sortBy, setSortBy] = useState({ outbound: "original", return: "original" });
    const [error, setError] = useState("");

    // Keep booking outcomes visible after the request completes.
    const [booking, setBooking] = useState(false);
    const [reservation, setReservation] = useState<{id:number;summary:string} | null>(null);
    const retrySearch = useRef<FlightSearch | null>(null);
    const [bookingError, setBookingError] = useState("");
    const { error: toastError, warning } = useFeedback();

    /**
     * True from the click that starts a booking until its request has settled.
     *
     * A ref, not the `booking` state above: state only reaches the button after a
     * re-render, and `submitBooking` awaits a session probe before setting it, so
     * two clicks a moment apart both got through and bought two identical tickets
     * — two rows in the booking history at the same price, paid for twice. The
     * ref is set before the first `await`, so the second click finds the booking
     * already in flight and does nothing.
     */
    const bookingInFlight = useRef(false);
    const searchVersion = useRef(0);
    const searchController = useRef<AbortController | null>(null);
    useEffect(() => () => { searchVersion.current += 1; searchController.current?.abort(); }, []);

    // For selected flight group IDs (for round-trip booking).
    //
    // One per direction, not a list: a round trip is one outbound and one
    // return, and the ticket is a single itinerary of outbound legs followed by
    // return legs. Letting several be ticked would let a traveller assemble an
    // itinerary with two outbounds, which `handleBookRoundTrip` could only reject
    // — after they had already chosen everything. The control is what enforces
    // the rule, so the invalid state cannot be reached.
    const [selectedOutboundGroupId, setSelectedOutboundGroupId] = useState<string | null>(null);
    const [selectedReturnGroupId, setSelectedReturnGroupId] = useState<string | null>(null);

    /*
     * The legs of every result the page is currently showing, keyed by the id a
     * selection stores — that is, `generateGroupId(group.flights)`.
     *
     * A selection is remembered as that joined id, and splitting the string back
     * apart would recover the ids and nothing else: the times a booking check
     * needs live on the legs. Looking them up here is what lets the page explain
     * why a selection cannot be booked instead of forwarding a payload the
     * provider refuses.
     */
    const resultsById = new Map<string, Flight[]>(
        [...outboundFlightGroups, ...returnFlightGroups].map((group) => [
            generateGroupId(group.flights),
            group.flights,
        ])
    );

    /** The legs of a selected group, or none when the selection is stale. */
    const selectedFlights = (groupId: string | null): Flight[] => {
        if (groupId === null) {
            return [];
        }
        // A selection whose flights are no longer in the results (a new search
        // replaced them) contributes nothing and is reported by the booking bar.
        return resultsById.get(groupId) ?? [];
    };

    const outboundSelection = selectedFlights(selectedOutboundGroupId);
    const returnSelection = selectedFlights(selectedReturnGroupId);

    // Derive the booking total and readiness from the selected legs.
    const roundTripSelection = (() => {
        if (tripType !== "round-trip") {
            return null;
        }
        const flights = [...outboundSelection, ...returnSelection];
        if (flights.length === 0) {
            return { flights, total: 0, ready: false, note: "" };
        }
        const total = flights.reduce((sum, flight) => sum + flight.price, 0);
        /*
         * A stale selection first: a selection whose flights are gone from the
         * results — because a new search replaced them — looks exactly like "that
         * half is not chosen yet", and reporting it that way would send the
         * traveller looking for a choice they have already made.
         */
        if (selectedOutboundGroupId !== null && outboundSelection.length === 0) {
            return { flights, total, ready: false, note: "The outbound selection is out of date — search again" };
        }
        if (selectedReturnGroupId !== null && returnSelection.length === 0) {
            return { flights, total, ready: false, note: "The return selection is out of date — search again" };
        }
        if (outboundSelection.length === 0) {
            return { flights, total, ready: false, note: "Choose an outbound flight" };
        }
        if (returnSelection.length === 0) {
            return { flights, total, ready: false, note: "Choose a return flight" };
        }
        /*
         * The same rule the provider enforces, reported here where the page can
         * name the flight: the return half is part of the same ticket, so its first
         * leg has to leave after the last outbound leg lands.
         */
        const blocker = bookingBlocker(flights);
        if (blocker !== null) {
            return { flights, total, ready: false, note: blocker };
        }
        return { flights, total, ready: true, note: "" };
    })();

    // Redirect to login if not logged in.
    const ensureLoggedIn = async (): Promise<boolean> => {
        const token = await recoverSession();
        if (!token) {
            router.push(signInForSelection());
            return false;
        }
        const response = await sessionFetch("/api/user", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (response.status === 401) {
            clearAccessToken();
            router.push("/auth/refresh");
            return false;
        }
        return true;
    };

    // Function to perform flight search.
    const performFlightSearch = useCallback(async (
        origin: string,
        destination: string,
        date: string,
        signal: AbortSignal
    ): Promise<FlightGroup[]> => {
        const query = new URLSearchParams({
            origin,
            destination,
            date,
        }).toString();
        const res = await sessionFetch(`/api/flights/search?${query}`, { signal,
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Flight search failed");
        }

        const data = await res.json();

        // Process flight groups to calculate total price and duration for connecting flights.
        const processedGroups: FlightGroup[] = (data as FlightGroup[]).map(
            (group) => {
                const totalPrice = group.flights.reduce(
                    (sum, flight) => sum + flight.price,
                    0
                );
                // Compare whole journeys, including the time spent between connecting flights.
                const first = group.flights[0];
                const last = group.flights[group.flights.length - 1];
                const elapsed = (Date.parse(last?.arrivalTime ?? "") - Date.parse(first?.departureTime ?? "")) / 60000;
                const totalDuration = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed
                    : group.flights.length === 1 ? first.durationMinutes : undefined;

                return {
                    ...group,
                    totalPrice,
                    totalDuration,
                };
            }
        );

        return processedGroups;
    }, []);

    const runSearch = useCallback(async (selection: FlightSearch) => {
        const { origin, destination, date, returnDate, tripType } = selection;
        const version = ++searchVersion.current;
        searchController.current?.abort();
        const controller = new AbortController();
        searchController.current = controller;
        setLoading(true);
        setError("");
        retrySearch.current = null;
        setBookingError("");
        setOutboundFlightGroups([]);
        setReturnFlightGroups([]);
        setSelectedOutboundGroupId(null);
        setSelectedReturnGroupId(null);
        setActiveDirection("outbound");

        try {
            const isRoundTrip = tripType === "round-trip" && returnDate.length > 0;

            /*
             * A return that leaves before the outbound lands cannot be part of one
             * trip. Rejecting it here rather than showing the return results means
             * the traveller never picks a return leg that cannot be booked with
             * the outbound they are about to choose — which is what produced
             * "Flights are not consecutive in sequence" at booking time.
             */
            if (isRoundTrip && returnDate <= date) {
                throw new Error(
                    "The return date must be after the outbound date: a return flight cannot leave before the outbound arrives."
                );
            }
            retrySearch.current = selection;

            /*
             * A round trip is two independent searches, so they run together. The
             * upstream flight search is the slowest call in the application and
             * awaiting one before starting the other doubles the time the user
             * spends looking at a spinner for no reason.
             */
            const [outbound, inbound] = await Promise.all([
                performFlightSearch(origin, destination, date, controller.signal),
                isRoundTrip
                    ? performFlightSearch(destination, origin, returnDate, controller.signal)
                    : Promise.resolve<FlightGroup[]>([]),
            ]);

            if (version !== searchVersion.current || controller.signal.aborted) return;
            setSearched(true);
            setSearchDetails({ origin, destination, date, returnDate });
            setOutboundFlightGroups(outbound);
            if (isRoundTrip) {
                setReturnFlightGroups(inbound);
            }
        } catch (err) {
            if (version !== searchVersion.current || controller.signal.aborted) return;
            const failure = err instanceof Error ? err.message : "The flight search failed.";
            setError(failure);
            toastError("Flight search failed", { description: failure });
        } finally {
            if (version === searchVersion.current && !controller.signal.aborted) setLoading(false);
        }
    }, [performFlightSearch, toastError]);

    useEffect(() => {
        const restore = () => {
            const search = readFlightSearch(new URLSearchParams(window.location.search));
            setOrigin(search.origin); setDestination(search.destination); setDate(search.date); setReturnDate(search.returnDate); setTripType(search.tripType);
            if (search.origin && search.destination && search.date && (search.tripType === "one-way" || search.returnDate)) void runSearch(search);
            else { searchVersion.current++; searchController.current?.abort(); setLoading(false); setSearched(false); setError(""); }
        };
        restore();
        window.addEventListener("popstate",restore);
        return () => window.removeEventListener("popstate",restore);
    }, [runSearch]);

    const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const search = {origin,destination,date,returnDate,tripType};
        const path = flightSearchPath(search);
        if (path !== window.location.pathname + window.location.search) window.history.pushState(null,"",path);
        void runSearch(search);
    };

    // Helper function to fetch user info from the backend.
    const fetchUserInfo = async () => {
        const token = getAccessToken();
        if (!token) {
            throw new Error("User not logged in");
        }
        const res = await sessionFetch("/api/user", {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to fetch user info");
        }
        const data = await res.json();
        return data.user;
    };

    /**
     * Buy `flights` as one ticket.
     *
     * One path for both trip types: a round trip is the outbound legs followed by
     * the return legs in one `flightIds` array, which is exactly what the
     * provider's `POST /api/bookings` accepts.
     *
     * `returnLegCount` says where the outbound half ends, because the flat array
     * does not: a one-way ticket with a connection and a round trip are both
     * "several legs in order", and the booking history renders them very
     * differently — one direction or two. The page knows the split exactly, so it
     * declares it instead of leaving the server to infer it from the times.
     */
    const submitBooking = async (flights: Flight[], returnLegCount = 0) => {
        // Before the first `await`: see `bookingInFlight`.
        if (bookingInFlight.current) return;
        bookingInFlight.current = true;
        setBooking(true);
        setBookingError("");

        try {
            if (!(await ensureLoggedIn()) || flights.length === 0) return;

            /*
             * Last line of defence before the request. The provider refuses an
             * itinerary like this with a message that does not say which leg is the
             * problem; here the page can.
             */
            const blocker = bookingBlocker(flights);
            if (blocker !== null) {
                setBookingError(blocker);
                warning("Check your selected flights", { description: blocker });
                return;
            }

            const user = await fetchUserInfo();
            const token = getAccessToken();
            if (!token) {
                router.push(signInForSelection());
                return;
            }

            const res = await bookingRequest("/api/flights/book", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    flightIds: flights.map((f) => f.id),
                    returnLegCount,
                }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const failure = res.status >= 500 ? "The result is unknown. Retry with the same selection or check My Flight Bookings before starting a new booking." : data.error || "Unknown error";
                setBookingError("Booking failed: " + failure);
                toastError("Booking failed", { description: failure });
                return;
            }

            const split = flights.length - returnLegCount;
            const summary = returnLegCount
                ? "Outbound: " + routeText(flights.slice(0, split)) + " · Return: " + routeText(flights.slice(split))
                : "One-way · " + routeText(flights);
            setReservation({id:data.reservationId, summary});
            await acknowledgeBooking("/api/flights/book", { email: user.email, firstName: user.firstName, lastName: user.lastName, flightIds: flights.map(f => f.id), returnLegCount });
        } catch (error: any) {
            const failure = "The result is unknown. Retry with the same selection or check My Flight Bookings.";
            setBookingError(failure + " " + error.message);
            toastError("Booking failed", {
                description: error?.message
                    ? `${failure} ${error.message}`
                    : failure,
            });
        } finally {
            bookingInFlight.current = false;
            setBooking(false);
        }
    };

    // Handle booking for one-way flights. One direction, however many legs it takes.
    const handleBookOneWay = async (flights: Flight[]) => {
        setSelectedOutboundGroupId(generateGroupId(flights));
        await submitBooking(flights, 0);
    };

    // Handle booking for round-trip flights.
    const handleBookRoundTrip = async () => {
        const selection = roundTripSelection;
        if (selection === null || !selection.ready) {
            setBookingError(
                selection?.note || "Select one outbound and one return flight first."
            );
            return;
        }
        // The selected return legs are the trailing ones in `selection.flights`,
        // which is outbound first.
        await submitBooking(selection.flights, returnSelection.length);
    };

    const renderFlightDetails = (flight: Flight) => (
        <div className="flight-segment">
            <div className="segment-airline"><span className="airline-mark" aria-hidden="true">↗</span><div><strong>{flight.airline?.name ?? "Airline"}</strong><span>{flight.flightNumber ?? "Flight details"}</span></div></div>
            <div className="segment-route">
                <div><time className="segment-clock" dateTime={flight.departureTime}>{flight.departureTime ? new Date(flight.departureTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Time unavailable"}</time><strong>{airportLabel(flight.origin?.code, flight.origin?.city)}</strong><span>{flight.departureTime ? new Date(flight.departureTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span></div>
                <div className="segment-duration"><span>{flight.durationMinutes != null ? formatDuration(flight.durationMinutes) : "—"}</span><span className="segment-line" aria-hidden="true" /></div>
                <div><time className="segment-clock" dateTime={flight.arrivalTime}>{flight.arrivalTime ? new Date(flight.arrivalTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Time unavailable"}</time><strong>{airportLabel(flight.destination?.code, flight.destination?.city)}</strong><span>{flight.arrivalTime ? new Date(flight.arrivalTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span></div>
            </div>
            <div className="segment-meta"><span>{flight.availableSeats ?? "Unknown"} seats available</span><span>${flight.price.toFixed(2)} USD / segment</span></div>
        </div>
    );

    const showDirection = (direction: "outbound" | "return") => {
        setActiveDirection(direction);
        if (resultsRef.current) {
            const top = resultsRef.current.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: Math.max(0, top - (toolbarRef.current?.offsetHeight ?? 0) - 24) });
        }
    };

    const renderResults = (direction: "outbound" | "return") => {
        const outbound = direction === "outbound";
        const groups = outbound ? outboundFlightGroups : returnFlightGroups;
        const sort = sortBy[direction];
        const sortedGroups = [...groups];
        if (sort === "price") sortedGroups.sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity));
        if (sort === "duration") sortedGroups.sort((a, b) => (a.totalDuration ?? Infinity) - (b.totalDuration ?? Infinity));
        const selectedId = outbound ? selectedOutboundGroupId : selectedReturnGroupId;
        const selected = outbound ? outboundSelection : returnSelection;
        const selectedStops = searchRoute(selected).stops;
        const title = outbound ? "Outbound Flights" : "Return Flights";
        const departureDay = outbound ? searchDetails.date : searchDetails.returnDate;
        return (
            <section id={direction + "-results"} className="flight-results-panel" data-active={activeDirection === direction} aria-labelledby={direction + "-heading"}>
                <header className="flight-results-heading">
                    <div className="flight-results-title">
                        <h2 id={direction + "-heading"} className="heading text-2xl font-semibold">{title}</h2>
                        {groups.length > 1 && <label className="flight-sort">Sort by
                            <select aria-label={"Sort " + direction + " flights"} value={sort} onChange={event => setSortBy({ ...sortBy, [direction]: event.target.value })}>
                                <option value="original">Search order</option>
                                <option value="price">Lowest price</option>
                                <option value="duration">Shortest trip</option>
                            </select>
                        </label>}
                    </div>
                    <p className="flight-results-route">{airportLabel(outbound ? searchDetails.origin : searchDetails.destination)} → {airportLabel(outbound ? searchDetails.destination : searchDetails.origin)}</p>
                    <p className="muted text-sm"><time dateTime={departureDay}>{departureDay ? new Date(departureDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : ""}</time>{" · "}{groups.length} option{groups.length === 1 ? "" : "s"}{" · Times in "}{flightClock.resolvedOptions().timeZone}</p>
                    {tripType === "round-trip" && <p className="flight-selection-summary">{selected.length ? "Selected: " + selected.map(flight => flight.flightNumber ?? flight.id).join(" + ") + (selectedStops.length ? " via " + selectedStops.join(" → ") : "") + " · $" + selected.reduce((sum, flight) => sum + flight.price, 0).toFixed(2) + " USD" : "Choose your " + direction + " flight below."}</p>}
                </header>
                {groups.length ? <ul className="flight-results-list" aria-label={title + " options"} tabIndex={0}>
                    {sortedGroups.map((group) => {
                        const groupId = generateGroupId(group.flights);
                        const isSelected = tripType === "round-trip" && selectedId === groupId;
                        const first = group.flights[0];
                        const last = group.flights[group.flights.length - 1];
                        const route = searchRoute(group.flights);
                        return <li key={groupId} className={"flight-result-card surface" + (isSelected ? " is-selected" : "")}>
                            <div className="flight-result-overview">
                                <div className="flight-schedule">
                                    <SchedulePoint stamp={first?.departureTime} airport={route.from} />
                                    <span aria-hidden="true" className="muted">→</span>
                                    <SchedulePoint stamp={last?.arrivalTime} airport={route.to} />
                                </div>
                                <p className="flight-result-price">{group.totalPrice != null ? "$" + group.totalPrice.toFixed(2) : "N/A"}<span>USD / traveller</span></p>
                            </div>
                            <p className="flight-comparison"><strong>{stopsLabel(group.legs)}{route.stops.length > 0 && " via " + route.stops.join(" → ")}</strong>{group.totalDuration != null && " · " + formatDuration(group.totalDuration)}{" · "}{Array.from(new Set(group.flights.map(flight => flight.airline?.name ?? "Airline"))).join(" / ")}</p>
                            <details className="flight-details"><summary>Flight details</summary>
                            {group.flights.map((flight, flightIndex) => <div key={flight.id ?? flightIndex}>
                                {flightIndex > 0 && <p className="my-4 text-center text-sm muted">{layoverLabel(group.flights[flightIndex - 1], flight)}</p>}
                                {renderFlightDetails(flight)}
                            </div>)}
                            </details>
                            {tripType === "one-way" ? <button type="button" onClick={() => handleBookOneWay(group.flights)} disabled={booking} className="button-primary mt-4">{booking ? "Booking…" : "Book One‑Way"}</button> : <button
                                type="button"
                                className={"flight-select-button" + (isSelected ? " is-selected" : "")}
                                aria-pressed={isSelected}
                                aria-label={(isSelected ? "Selected" : "Select flight") + ": " + direction + " " + group.flights.map(flight => flight.flightNumber ?? flight.id).join(", ")}
                                disabled={booking || loading}
                                onClick={() => outbound ? setSelectedOutboundGroupId(groupId) : setSelectedReturnGroupId(groupId)}
                            >{isSelected && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}{isSelected ? "Selected" : "Select flight"}</button>}
                        </li>;
                    })}
                </ul> : <p role="status" className="surface p-6 muted">No {direction} flights found. Try different airports or a different {outbound ? "departure" : "return"} date.</p>}
                {!groups.length && <button type="button" className="button-secondary mt-3" onClick={()=>document.getElementById(outbound ? "outbound-date" : "return-date")?.focus()}>Change search</button>}
            </section>
        );
    };

    return (
        <div className="flight-search-page search-page page-shell">
            <BookingSteps current="reserve" />
            <h1 className="search-title">Find your next flight</h1>
            <p className="search-intro">Compare routes, connections and fares. All times follow your device time zone{deviceTimeZone ? ` (${deviceTimeZone})` : ""}. Prices are in USD.</p>

            <form onSubmit={handleSearch} className="search-form mb-8">
                <div className="trip-switch" role="group" aria-label="Trip type">
                    <button
                        type="button"
                        disabled={loading || booking}
                        aria-pressed={tripType === "one-way"}
                        onClick={() => { setTripType("one-way"); setSearched(false); setOutboundFlightGroups([]); setReturnFlightGroups([]); setSelectedOutboundGroupId(null); setSelectedReturnGroupId(null); }}
                    >
                        One‑way
                    </button>
                    <button
                        type="button"
                        disabled={loading || booking}
                        aria-pressed={tripType === "round-trip"}
                        onClick={() => { setTripType("round-trip"); setSearched(false); setOutboundFlightGroups([]); setReturnFlightGroups([]); setSelectedOutboundGroupId(null); setSelectedReturnGroupId(null); }}
                    >
                        Round Trip
                    </button>
                </div>
                <div className="flight-search-fields" data-trip-type={tripType}>
                    {/* Outbound Flight Inputs */}
                    <LocationCombobox label="From" kind="airports" value={origin} onChange={setOrigin} placeholder="City or airport code" disabled={booking} />
                    <LocationCombobox label="To" kind="airports" value={destination} onChange={setDestination} placeholder="Where are you going?" disabled={booking} />
                    <div>
                        <label htmlFor="outbound-date" className="label">Departure date:</label>
                        <input
                            id="outbound-date"
                            type="date"
                            disabled={booking}
                            value={date}
                            min={localDay(new Date())}
                            onChange={(e) => setDate(e.target.value)}
                            required
                            className="field"
                        />
                    </div>
                    <div hidden={tripType === "one-way"}>
                        <label htmlFor="return-date" className="label">Return date:</label>
                        <input
                            id="return-date"
                            type="date"
                            disabled={booking || tripType === "one-way"}
                            value={returnDate}
                            /*
                             * A return cannot leave on the day the outbound departs:
                             * the ticket is one itinerary, so its legs have to be in
                             * order. The `min` is the day after the outbound, which
                             * is also the rule `handleSearch` enforces for a typed
                             * or restored value.
                             */
                            min={earliestReturnDay(date)}
                            onChange={(e) => setReturnDate(e.target.value)}
                            required={tripType === "round-trip"}
                            className="field"
                        />
                    </div>
                </div>
                <div className="flight-search-actions">
                    <p className="muted text-sm">Demo flights use a synthetic passenger identifier. No passport details are needed.</p>
                    <button type="submit" disabled={loading || booking} className="button-primary">
                        {loading ? "Searching flights…" : "Search flights"}
                    </button>
                </div>
            </form>

            {loading && <p role="status" className="muted">Loading flights...</p>}
            {error && <div role="alert" className="surface p-5 mb-6"><p className="text-red-600 dark:text-red-400">{error}</p>{retrySearch.current && <button type="button" className="button-secondary mt-3" onClick={()=>{if (retrySearch.current) void runSearch(retrySearch.current);}}>Retry search</button>}</div>}
            {/* Keep booking outcomes available after their toasts close. */}
            {reservation && <ReservationSuccess kind="flight" reservationId={reservation.id} summary={reservation.summary} />}
            {bookingError && (
                <p role="alert" className="text-red-600 dark:text-red-400">
                    {bookingError}
                </p>
            )}

            {searched && !loading && !error && <>
                {tripType === "round-trip" && <div ref={toolbarRef} className="flight-results-toolbar">
                    {roundTripSelection && roundTripSelection.flights.length > 0 ? <RoundTripBar
                        selection={roundTripSelection}
                        outboundLegs={outboundSelection.length}
                        booking={booking}
                        error={bookingError}
                        onBook={handleBookRoundTrip}
                    /> : <p className="muted text-sm">Select one outbound and one return flight to build your round trip.</p>}
                    <div className="flight-direction-switch" role="group" aria-label="Flight direction">
                        {(["outbound", "return"] as const).map(direction => {
                            const selected = direction === "outbound" ? outboundSelection : returnSelection;
                            return <button key={direction} type="button" aria-pressed={activeDirection === direction} aria-controls={direction + "-results"} onClick={() => showDirection(direction)}>
                                <span>{direction === "outbound" ? "Outbound" : "Return"}</span><span>{selected.length ? "Selected · $" + selected.reduce((sum, flight) => sum + flight.price, 0).toFixed(2) : "Choose a flight"}</span>
                            </button>;
                        })}
                    </div>
                </div>}
                <div ref={resultsRef} className={"flight-results-grid" + (tripType === "round-trip" ? " is-round-trip" : "")}>
                    {renderResults("outbound")}
                    {tripType === "round-trip" && renderResults("return")}
                </div>
            </>}

        </div>
    );
}

interface RoundTripBarProps {
    selection: { flights: Flight[]; total: number; ready: boolean; note: string; };
    outboundLegs: number;
    booking: boolean;
    error: string;
    onBook: () => void;
}

function RoundTripBar({ selection, outboundLegs, booking, error, onBook }: RoundTripBarProps) {
    const directions = [
        { title: "Outbound", flights: selection.flights.slice(0, outboundLegs) },
        { title: "Return", flights: selection.flights.slice(outboundLegs) },
    ];
    return <div className="round-trip-bar" role="region" aria-label="Round trip selection">
        <div className="round-trip-total"><span className="text-sm font-semibold heading">{directions.every(direction => direction.flights.length > 0) ? "Round-trip total" : "Selected fare"}</span><strong className="heading">$<span>{selection.total.toFixed(2)}</span> <span className="text-xs muted">USD</span></strong></div>
        <button type="button" onClick={onBook} disabled={booking || !selection.ready} className="button-primary round-trip-book">{booking ? "Booking…" : "Book Round Trip"}</button>
        <p className="round-trip-note text-xs muted" role="status">{selection.note || "Outbound and return selected."}</p>
        <details className="round-trip-details">
            <summary>View selected flights</summary>
            <div>{directions.map(({ title, flights }) => <div key={title}>
                <strong className="heading">{title}</strong>
                {flights.length ? <>
                    <p>{routeText(flights)} · {flights.map(flight => flight.flightNumber ?? flight.id).join(" + ")}</p>
                    <p>{flights[0]?.departureTime ? new Date(flights[0].departureTime).toLocaleString("en-US") : "Time unavailable"} · ${flights.reduce((sum, flight) => sum + flight.price, 0).toFixed(2)} USD</p>
                </> : <p>Choose a flight</p>}
            </div>)}</div>
        </details>
        {error && <p className="round-trip-error text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>;
}
