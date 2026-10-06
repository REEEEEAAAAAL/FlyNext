"use client";

import { useRef, useState } from "react";
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

/*
 * Define Airport interface for suggestions, matching what
 * `GET /api/locations/airports` actually returns: the row's `city` is the
 * related `City` record, not a string. Declaring it as a string here made the
 * dropdown render "[object Object]" instead of the city name.
 */
interface Airport {
    id: number;
    code: string;
    name: string;
    country: string;
    city: { id: number; name: string } | null;
}

/** Names the airport's city, or falls back to the airport's own country. */
const airportCity = (airport: Airport): string =>
    airport.city?.name ?? airport.country;

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
    return date.toLocaleDateString();
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
        return `These flights cannot be booked as one trip, because the connection at ${flights[index].origin?.code ?? "the hub"} leaves less than an hour after the previous leg lands. Choose a different connection.`;
    }
    return null;
};

/**
 * The words a traveller needs between two legs of one itinerary: where they
 * wait, how long for, and — for a connection that lands on the next day — when
 * the onward flight actually leaves.
 */
const layoverLabel = (previous: Flight, next: Flight): string => {
    const where = `Layover at ${next.origin?.city ?? "the hub"} (${next.origin?.code ?? "?"})`;
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

    /*
     * The passport number the ticket is issued against.
     *
     * Collected from the traveller on the booking form: a single hard-coded value
     * here would issue every ticket in the system to the same invented passenger.
     * It reaches the provider at all only because that check counts characters
     * rather than digits, so the field has to be a real one.
     */
    const [passportNumber, setPassportNumber] = useState("");

    // Flight results for outbound and return.
    const [outboundFlightGroups, setOutboundFlightGroups] = useState<FlightGroup[]>([]);
    const [returnFlightGroups, setReturnFlightGroups] = useState<FlightGroup[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    /*
     * Booking outcomes are shown as toasts, and the toast is the only place a
     * booking result is reported: it survives the next click and does not block
     * the tab the way an `alert()` does, so a failure cannot be missed. The
     * page-level `bookingError` state survives only for the form's own inline
     * validation, which has to point at the field that needs fixing.
     */
    const [booking, setBooking] = useState(false);
    const [bookingMessage, setBookingMessage] = useState("");
    const [bookingError, setBookingError] = useState("");
    const { success, error: toastError, warning } = useFeedback();

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

    // For auto-suggestions.
    const [originSuggestions, setOriginSuggestions] = useState<Airport[]>([]);
    const [destinationSuggestions, setDestinationSuggestions] = useState<Airport[]>([]);
    const [showOriginDropdown, setShowOriginDropdown] = useState(false);
    const [showDestinationDropdown, setShowDestinationDropdown] = useState(false);

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

    /**
     * What the floating bar offers to buy, and whether it can.
     *
     * `null` when there is nothing to book yet. The selections are the source of
     * truth: the bar renders the price of exactly these legs, so it cannot offer a
     * total the booking would not charge.
     */
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
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return false;
        }
        const response = await fetch("/api/user", {
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

    // Fetch suggestions from /api/locations/airports?q=...
    const fetchSuggestions = async (query: string): Promise<Airport[]> => {
        try {
            const res = await fetch(`/api/locations/airports?q=${encodeURIComponent(query)}`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });
            if (res.ok) {
                const data = await res.json();
                return data.airports || [];
            }
        } catch (err) {
            console.error("Error fetching suggestions", err);
        }
        return [];
    };

    // Handlers for origin/destination input changes.
    const handleOriginChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setOrigin(value);
        if (value.length >= 2) {
            const suggestions = await fetchSuggestions(value);
            setOriginSuggestions(suggestions);
            setShowOriginDropdown(true);
        } else {
            setOriginSuggestions([]);
            setShowOriginDropdown(false);
        }
    };

    const handleDestinationChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setDestination(value);
        if (value.length >= 2) {
            const suggestions = await fetchSuggestions(value);
            setDestinationSuggestions(suggestions);
            setShowDestinationDropdown(true);
        } else {
            setDestinationSuggestions([]);
            setShowDestinationDropdown(false);
        }
    };

    const selectOriginSuggestion = (airport: Airport) => {
        setOrigin(airport.code);
        setOriginSuggestions([]);
        setShowOriginDropdown(false);
    };

    const selectDestinationSuggestion = (airport: Airport) => {
        setDestination(airport.code);
        setDestinationSuggestions([]);
        setShowDestinationDropdown(false);
    };

    // Function to perform flight search.
    const performFlightSearch = async (
        origin: string,
        destination: string,
        date: string
    ): Promise<FlightGroup[]> => {
        const query = new URLSearchParams({
            origin,
            destination,
            date,
        }).toString();
        const res = await fetch(`/api/flights/search?${query}`, {
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
                // `durationMinutes` only: a leg without one contributes nothing
                // rather than poisoning the sum with a string.
                const totalDuration = group.flights.reduce(
                    (sum, flight) =>
                        typeof flight.durationMinutes === "number"
                            ? sum + flight.durationMinutes
                            : sum,
                    0
                );

                return {
                    ...group,
                    totalPrice,
                    totalDuration,
                };
            }
        );

        return processedGroups;
    };

    const handleSearch = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setBookingMessage("");
        setBookingError("");
        setOutboundFlightGroups([]);
        setReturnFlightGroups([]);
        setSelectedOutboundGroupId(null);
        setSelectedReturnGroupId(null);

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

            /*
             * A round trip is two independent searches, so they run together. The
             * upstream flight search is the slowest call in the application and
             * awaiting one before starting the other doubles the time the user
             * spends looking at a spinner for no reason.
             */
            const [outbound, inbound] = await Promise.all([
                performFlightSearch(origin, destination, date),
                isRoundTrip
                    ? performFlightSearch(destination, origin, returnDate)
                    : Promise.resolve<FlightGroup[]>([]),
            ]);

            setOutboundFlightGroups(outbound);
            if (isRoundTrip) {
                setReturnFlightGroups(inbound);
            }
        } catch (err: any) {
            const failure = err.message || "The flight search failed.";
            setError(failure);
            toastError("Flight search failed", { description: failure });
        } finally {
            setLoading(false);
        }
    };

    // Helper function to fetch user info from the backend.
    const fetchUserInfo = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            throw new Error("User not logged in");
        }
        const res = await fetch("/api/user", {
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
        setBookingMessage("");

        try {
            if (!(await ensureLoggedIn()) || flights.length === 0) return;

            /*
             * The provider refuses a booking without a passport and checks only its
             * length, so an empty field is caught here with a message that says which
             * input to fill in, rather than as a 400 naming the JSON field.
             */
            const passport = passportNumber.trim();
            if (passport.length < 9) {
                const failure =
                    "Enter a passport number of at least 9 characters before booking.";
                setBookingError(failure);
                warning("Passport number needed", { description: failure });
                return;
            }

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
            const token = localStorage.getItem("accessToken");
            if (!token) {
                router.push("/auth/login");
                return;
            }

            const res = await fetch("/api/flights/book", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    passportNumber: passport,
                    flightIds: flights.map((f) => f.id),
                    returnLegCount,
                }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const failure = data.error || "Unknown error";
                setBookingError("Booking failed: " + failure);
                toastError("Booking failed", { description: failure });
                return;
            }

            const message = `Reservation #${data.reservationId} is confirmed.`;
            setBookingMessage(message);
            success("Flight booked", {
                description: `${message} Add it to an itinerary from the itineraries page.`,
            });
        } catch (error: any) {
            const failure = "An error occurred while booking the flight.";
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

    // Render flight details including city information.
    const renderFlightDetails = (flight: Flight) => (
        <div className="mb-4 pl-4 border-l-2 border-gray-300 dark:border-white/15">
            <p className="text-gray-800 dark:text-zinc-200">
                <strong>Flight Number:</strong> {flight.flightNumber || "N/A"}
            </p>
            <p className="text-gray-800 dark:text-zinc-200">
                <strong>Airline:</strong> {flight.airline ? flight.airline.name : "N/A"}
            </p>
            <p className="text-gray-800 dark:text-zinc-200">
                <strong>Departure:</strong>{" "}
                {flight.departureTime ? new Date(flight.departureTime).toLocaleString() : "N/A"}
                {flight.origin && ` (${flight.origin.code} - ${flight.origin.city})`}
            </p>
            <p className="text-gray-800 dark:text-zinc-200">
                <strong>Arrival:</strong>{" "}
                {flight.arrivalTime ? new Date(flight.arrivalTime).toLocaleString() : "N/A"}
                {flight.destination && ` (${flight.destination.code} - ${flight.destination.city})`}
            </p>
            <p className="text-gray-800 dark:text-zinc-200">
                <strong>Duration:</strong>{" "}
                {flight.durationMinutes != null
                    ? formatDuration(flight.durationMinutes)
                    : "N/A"}
            </p>
            <p className="text-gray-800 dark:text-zinc-200">
                <strong>Available Seats:</strong>{" "}
                {flight.availableSeats != null ? flight.availableSeats : "N/A"}
            </p>
            <p className="text-gray-800 dark:text-zinc-200">
                <strong>Price:</strong>{" "}
                {flight.price != null ? `$${flight.price.toFixed(2)}` : "N/A"}
            </p>
        </div>
    );

    return (
        /*
         * The extra bottom padding is room for the floating round-trip bar, which
         * is fixed to the viewport: without it the bar would cover the last result
         * card, and the only way to read that card would be to close the bar by
         * changing the selection.
         */
        <div className="max-w-4xl mx-auto p-8 pb-40 card">
            <h1 className="text-3xl font-bold mb-6 heading">Flight Search</h1>

            {/* Trip Type Toggle */}
            <div className="flex space-x-4 mb-6">
                <button
                    className={`px-4 py-2 rounded transition-colors ${tripType === "one-way" ? "bg-black text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-gray-200 text-gray-800 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-1 dark:ring-white/10"}`}
                    onClick={() => setTripType("one-way")}
                >
                    One‑way
                </button>
                <button
                    className={`px-4 py-2 rounded transition-colors ${tripType === "round-trip" ? "bg-black text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-gray-200 text-gray-800 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-1 dark:ring-white/10"}`}
                    onClick={() => setTripType("round-trip")}
                >
                    Round Trip
                </button>
            </div>

            <form onSubmit={handleSearch} className="mb-6 space-y-4">
                {/* Outbound Flight Inputs */}
                <div className="relative">
                    <label className="label">Origin:</label>
                    <input
                        type="text"
                        value={origin}
                        onChange={handleOriginChange}
                        placeholder="e.g., YYZ"
                        required
                        className="field"
                        onFocus={() => origin.length >= 2 && setShowOriginDropdown(true)}
                        onBlur={() => setTimeout(() => setShowOriginDropdown(false), 150)}
                    />
                    {showOriginDropdown && originSuggestions.length > 0 && (
                        <ul className="absolute z-10 w-full max-h-60 overflow-y-auto floating">
                            {originSuggestions.map((airport) => (
                                <li
                                    key={airport.id}
                                    onClick={() => selectOriginSuggestion(airport)}
                                    className="p-2 cursor-pointer row-hover"
                                >
                                    {airport.code} - {airport.name} ({airportCity(airport)})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="relative">
                    <label className="label">Destination:</label>
                    <input
                        type="text"
                        value={destination}
                        onChange={handleDestinationChange}
                        placeholder="e.g., CAN"
                        required
                        className="field"
                        onFocus={() => destination.length >= 2 && setShowDestinationDropdown(true)}
                        onBlur={() => setTimeout(() => setShowDestinationDropdown(false), 150)}
                    />
                    {showDestinationDropdown && destinationSuggestions.length > 0 && (
                        <ul className="absolute z-10 w-full max-h-60 overflow-y-auto floating">
                            {destinationSuggestions.map((airport) => (
                                <li
                                    key={airport.id}
                                    onClick={() => selectDestinationSuggestion(airport)}
                                    className="p-2 cursor-pointer row-hover"
                                >
                                    {airport.code} - {airport.name} ({airportCity(airport)})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div>
                    <label className="label">Outbound Date:</label>
                    <input
                        type="date"
                        value={date}
                        min={localDay(new Date())}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        className="field"
                    />
                </div>
                {tripType === "round-trip" && (
                    <div>
                        <label className="label">Return Date:</label>
                        <input
                            type="date"
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
                            required
                            className="field"
                        />
                    </div>
                )}
                <div>
                    <label className="label">Passport Number:</label>
                    <input
                        type="text"
                        value={passportNumber}
                        onChange={(e) => setPassportNumber(e.target.value)}
                        placeholder="e.g., AB1234567"
                        minLength={9}
                        maxLength={20}
                        required
                        className="field"
                    />
                    <p className="muted text-sm mt-1">
                        Required by the airline to issue the ticket.
                    </p>
                </div>
                <button type="submit" className="px-6 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
                    Search Flights
                </button>
            </form>

            {loading && <p className="muted">Loading flights...</p>}
            {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
            {/*
              * Both outcomes are also raised as toasts at the moment they happen,
              * which is what a traveller actually notices. These inline copies stay
              * because the booking control sits far down a long results list: after
              * pressing it, the confirmation is still on screen next to the button
              * they pressed rather than only at the top of the viewport.
              */}
            {bookingMessage && (
                <p
                    role="status"
                    className="text-green-700 dark:text-green-400"
                >
                    {bookingMessage}
                </p>
            )}
            {bookingError && (
                <p role="alert" className="text-red-600 dark:text-red-400">
                    {bookingError}
                </p>
            )}

            {/* Outbound Flight Results */}
            {outboundFlightGroups.length > 0 && (
                <div className="mb-6">
                    <h2 className="text-2xl font-semibold mb-4 heading">Outbound Flights</h2>
                    <ul className="space-y-6">
                        {outboundFlightGroups.map((group, groupIndex) => (
                            <li key={groupIndex} className="p-6 surface">
                                <div className="mb-4">
                                    <p className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                                        {stopsLabel(group.legs)}
                                    </p>
                                    <p className="text-gray-800 dark:text-zinc-200">
                                        <strong>Total Price:</strong> ${group.totalPrice?.toFixed(2) || "N/A"}
                                    </p>
                                    <p className="text-gray-800 dark:text-zinc-200">
                                        <strong>Total Duration:</strong>{" "}
                                        {group.totalDuration != null ? formatDuration(group.totalDuration) : "N/A"}
                                    </p>
                                </div>
                                {group.flights.map((flight, flightIndex) => (
                                    <div key={flight.id ?? flightIndex}>
                                        {flightIndex > 0 && (
                                            <div className="my-4 text-center text-sm text-gray-500 dark:text-zinc-400">
                                                {layoverLabel(group.flights[flightIndex - 1], flight)}
                                            </div>
                                        )}
                                        {renderFlightDetails(flight)}
                                    </div>
                                ))}
                                {tripType === "one-way" && (
                                    <button
                                        onClick={() => handleBookOneWay(group.flights)}
                                        disabled={booking}
                                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
                                    >
                                        {booking ? "Booking…" : "Book One‑Way"}
                                    </button>
                                )}
                                {tripType === "round-trip" && (
                                    <div className="mt-4">
                                        {/*
                                         * A radio, not a check-box: exactly one
                                         * outbound is part of the ticket. The name
                                         * groups the whole result list, so picking
                                         * a second outbound replaces the first —
                                         * which is the only way the page can be
                                         * read as "choose your outbound".
                                         */}
                                        <label className="inline-flex items-center cursor-pointer">
                                            <input
                                                type="radio"
                                                name="selectedOutbound"
                                                checked={selectedOutboundGroupId === generateGroupId(group.flights)}
                                                onChange={() => setSelectedOutboundGroupId(generateGroupId(group.flights))}
                                                className="form-radio text-blue-600 dark:bg-zinc-800 dark:border-white/20"
                                            />
                                            <span className="ml-2 text-gray-800 dark:text-zinc-200">Select as Outbound</span>
                                        </label>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Return Flight Results for Round Trip */}
            {tripType === "round-trip" && (
                <div className="mb-6">
                    <h2 className="text-2xl font-semibold mb-4 heading">Return Flights</h2>
                    {returnFlightGroups.length > 0 ? (
                        <ul className="space-y-6">
                            {returnFlightGroups.map((group, groupIndex) => (
                                <li key={groupIndex} className="p-6 surface">
                                    <div className="mb-4">
                                        <p className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                                            {group.legs === 1 ? "Direct Flight" : `${group.legs - 1} Stop${group.legs > 2 ? "s" : ""}`}
                                        </p>
                                        <p className="text-gray-800 dark:text-zinc-200">
                                            <strong>Total Price:</strong> ${group.totalPrice?.toFixed(2) || "N/A"}
                                        </p>
                                        <p className="text-gray-800 dark:text-zinc-200">
                                            <strong>Total Duration:</strong>{" "}
                                            {group.totalDuration != null ? formatDuration(group.totalDuration) : "N/A"}
                                        </p>
                                    </div>
                                    {group.flights.map((flight, flightIndex) => (
                                        <div key={flight.id ?? flightIndex}>
                                            {flightIndex > 0 && (
                                                <div className="my-4 text-center text-sm text-gray-500 dark:text-zinc-400">
                                                    {layoverLabel(group.flights[flightIndex - 1], flight)}
                                                </div>
                                            )}
                                            {renderFlightDetails(flight)}
                                        </div>
                                    ))}
                                    <div className="mt-4">
                                        <label className="inline-flex items-center cursor-pointer">
                                            <input
                                                type="radio"
                                                name="selectedReturn"
                                                checked={selectedReturnGroupId === generateGroupId(group.flights)}
                                                onChange={() => setSelectedReturnGroupId(generateGroupId(group.flights))}
                                                className="form-radio text-blue-600 dark:bg-zinc-800 dark:border-white/20"
                                            />
                                            <span className="ml-2 text-gray-800 dark:text-zinc-200">Select as Return</span>
                                        </label>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="muted">No return flights found.</p>
                    )}
                </div>
            )}

            {roundTripSelection !== null && roundTripSelection.flights.length > 0 && (
                <RoundTripBar
                    selection={roundTripSelection}
                    booking={booking}
                    /*
                     * The failure is repeated in the bar because the page-level
                     * message is at the top of the form, and the traveller who just
                     * pressed this button is at the bottom of a long results list —
                     * they would click again rather than scroll up to find out why.
                     */
                    error={bookingError}
                    onBook={handleBookRoundTrip}
                />
            )}
        </div>
    );
}

/** What the floating round-trip bar needs to render. */
interface RoundTripBarProps {
    selection: {
        flights: Flight[];
        total: number;
        ready: boolean;
        note: string;
    };
    booking: boolean;
    /** The last booking failure, repeated beside the button that caused it. */
    error: string;
    onBook: () => void;
}

/**
 * The round-trip booking control, pinned to the bottom-right of the viewport.
 *
 * It carries the running total and the state of both halves, so the choice and
 * the button that commits it stay together: a traveller choosing an outbound near
 * the top of a long list can spend the selection without scrolling the whole page,
 * and the selection they are building cannot scroll out of sight while they do.
 *
 * `fixed` rather than `sticky`: a sticky element would still be pushed off screen
 * by the next result in the list. The page reserves room for it (see the
 * container's bottom padding) so it cannot cover the last card.
 */
function RoundTripBar({ selection, booking, error, onBook }: RoundTripBarProps) {
    const legs = selection.flights.length;
    return (
        <div
            className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-gray-300 bg-white p-4 shadow-xl dark:border-white/15 dark:bg-zinc-900"
            role="region"
            aria-label="Round trip selection"
        >
            <p className="text-sm font-semibold heading">
                Round trip · {legs} flight{legs === 1 ? "" : "s"}
            </p>
            <div className="mt-1 flex items-baseline justify-between">
                <span className="muted text-sm">Total</span>
                <span className="text-xl font-bold text-gray-900 dark:text-zinc-100">
                    ${selection.total.toFixed(2)}
                </span>
            </div>
            {selection.note ? (
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                    {selection.note}
                </p>
            ) : (
                <p className="mt-2 text-sm text-green-700 dark:text-emerald-400">
                    Outbound and return selected.
                </p>
            )}
            {error && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <button
                onClick={onBook}
                disabled={booking || !selection.ready}
                className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-500"
            >
                {booking ? "Booking…" : "Book Round Trip"}
            </button>
        </div>
    );
}

