"use client";

import { loginUrl } from "@/app/lib/return-path";

import { acknowledgeBooking, bookingRequest } from "@/app/lib/booking-request";
import { getAccessToken, sessionFetch, recoverSession } from "@/app/lib/session";

import LocationCombobox from "@/app/components/LocationCombobox";
import BookingSteps from "@/app/components/BookingSteps";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFeedback } from "@/app/context/FeedbackContext";
import { stayNights } from "@/app/lib/booking-display";
import { addDays, atMidnight, AVAILABILITY_HORIZON_DAYS, AVAILABILITY_HORIZON_ERROR, isStayWithinAvailabilityHorizon } from "@/lib/api/validation";

// Hotel interfaces
interface Hotel {
    id: number;
    name: string;
    address: string;
    location: string;
    starRating: number;
    images?: string[];
    roomTypes: RoomType[];
}

const EMPTY_HOTEL_FILTERS = { name: "", starRating: "", priceMin: "", priceMax: "" };

interface RoomType {
    id: number;
    name: string;
    amenities: string | null;
    pricePerNight: number;
    currentAvailability: number;
    availableRooms?: number | null;
    nights?: number | null;
    stayTotal?: number | null;
    currency?: string;
}

export default function HotelSearchPage() {
    const router = useRouter();
    const { success, error: toastError, warning, info } = useFeedback();
    const [city, setCity] = useState("");
    const [checkIn, setCheckIn] = useState("");
    const [checkOut, setCheckOut] = useState("");
    useEffect(() => {
        const saved = new URLSearchParams(window.location.search);
        setCity(saved.get("city") ?? ""); setCheckIn(saved.get("checkIn") ?? ""); setCheckOut(saved.get("checkOut") ?? "");
    }, []);

    const [availabilityStay, setAvailabilityStay] = useState("");
    const [filters, setFilters] = useState(EMPTY_HOTEL_FILTERS);
    const [hotels, setHotels] = useState<Hotel[]>([]);
    const [error, setError] = useState("");
    const [lastReservation, setLastReservation] = useState<{ id: number; checkIn: string; checkOut: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [bookingStatus, setBookingStatus] = useState<{
        [key: string]: "idle" | "loading" | "success" | "error";
    }>({});

    const searchVersion = useRef(0);
    const searchController = useRef<AbortController | null>(null);
    const loadHotels = useCallback(async (selectedCity = "", arrival = "", departure = "", selectedFilters = EMPTY_HOTEL_FILTERS) => {
        const version = ++searchVersion.current;
        searchController.current?.abort();
        const controller = new AbortController();
        searchController.current = controller;
        setLoading(true); setError("");
        try {
            const query = new URLSearchParams({ city: selectedCity, checkIn: arrival, checkOut: departure, ...selectedFilters });
            const response = await sessionFetch(`/api/hotels?${query}`, { signal: controller.signal });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not load stays. Please try again.");
            if (version !== searchVersion.current || controller.signal.aborted) return;
            setHotels(data.hotels || []);
            setAvailabilityStay(arrival && departure ? `${arrival}/${departure}` : "");
        } catch (failure) {
            if (!controller.signal.aborted && version === searchVersion.current) setError(failure instanceof Error ? failure.message : "Could not load stays.");
        } finally {
            if (!controller.signal.aborted && version === searchVersion.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        const saved = new URLSearchParams(window.location.search);
        const arrival = saved.get("checkIn") ?? ""; const departure = saved.get("checkOut") ?? "";
        void loadHotels(saved.get("city") ?? "", arrival, departure, EMPTY_HOTEL_FILTERS);
        return () => { searchVersion.current += 1; searchController.current?.abort(); };
    }, [loadHotels]);

    // Redirect to login if not logged in
    const ensureLoggedIn = async (): Promise<boolean> => {
        if (!await recoverSession()) {
            router.push(loginUrl(`/hotels?${new URLSearchParams({ city, checkIn, checkOut })}`));
            return false;
        }
        return true;
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if ((stayNights(checkIn, checkOut) ?? 0) < 1) { setError("Check-out must be after check-in."); return; }
        if (!isStayWithinAvailabilityHorizon(new Date(`${checkIn}T00:00:00.000Z`), new Date(`${checkOut}T00:00:00.000Z`))) { setError(AVAILABILITY_HORIZON_ERROR); return; }
        if (filters.priceMin && filters.priceMax && Number(filters.priceMin) > Number(filters.priceMax)) { setError("Maximum nightly rate must be at least the minimum."); return; }
        setBookingStatus({});
        void loadHotels(city, checkIn, checkOut, filters);
    };

    // Render star rating as stars
    const renderStars = (rating: number) => {
        return "★".repeat(rating) + "☆".repeat(5 - rating);
    };

    // Calculate stay duration in nights
    const calculateNights = (): number => {
        return stayNights(checkIn, checkOut) ?? 0;
    };

    const nights = calculateNights();
    const today = atMidnight(new Date());
    const latestCheckIn = addDays(today, AVAILABILITY_HORIZON_DAYS).toISOString().slice(0, 10);
    const latestCheckOut = addDays(today, AVAILABILITY_HORIZON_DAYS + 1).toISOString().slice(0, 10);

    /**
     * Book one room type for the selected dates.
     *
     * Every outcome is reported as a toast rather than an `alert()`: a booking
     * failure is the most important message this page produces, and a native
     * dialog blocks the tab, cannot be styled, and is dismissed by any stray
     * keypress. The two date guards run first so an obviously invalid range is
     * answered without a round trip and without a reservation id in the message.
     */
    const handleBookRoom = async (hotelId: number, roomTypeId: number) => {
        if (!await ensureLoggedIn()) return;

        if (!checkIn || !checkOut) {
            warning("Pick your dates first", {
                description:
                    "Choose a check-in and a check-out date to see this room's total and book it.",
            });
            return;
        }
        if ((stayNights(checkIn, checkOut) ?? 0) < 1) {
            warning("Check-out must be after check-in", {
                description: "A stay has to cover at least one night.",
            });
            return;
        }

        const bookingSearchVersion = searchVersion.current;
        setBookingStatus((prev) => ({
            ...prev,
            [`${hotelId}-${roomTypeId}`]: "loading",
        }));

        // A pinned toast: this one is resolved by the outcome below rather than by
        // a timer, so a slow booking still says what is happening.
        const pending = info("Reserving your room…", { duration: 0 });

        const token = getAccessToken();
        try {
            const res = await bookingRequest("/api/hotels/book", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    hotelId: String(hotelId),
                    roomTypeId: String(roomTypeId),
                    checkIn,
                    checkOut,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                // The API reports failures as `{ error }`; `message` is only read
                // as a fallback for responses that predate that field.
                toastError("Booking failed", {
                    description:
                        res.status >= 500 ? "The result is unknown. Retry with the same dates or check My Hotel Bookings before starting a new booking." : data?.error || data?.message || "Unknown error",
                });
                setBookingStatus((prev) => ({
                    ...prev,
                    [`${hotelId}-${roomTypeId}`]: "error",
                }));
                return;
            }

            const data = await res.json();

            if (bookingSearchVersion === searchVersion.current) await loadHotels(city, checkIn, checkOut, filters);

            setLastReservation({ id: data.reservation.id, checkIn, checkOut });
            success("Room booked", {
                description: `Reservation #${data.reservation.id} is confirmed for ${nights} ${
                    nights === 1 ? "night" : "nights"
                }. Add it to an itinerary from the itineraries page.`,
            });
            setBookingStatus((prev) => ({
                ...prev,
                [`${hotelId}-${roomTypeId}`]: "success",
            }));
            await acknowledgeBooking("/api/hotels/book", { hotelId: String(hotelId), roomTypeId: String(roomTypeId), checkIn, checkOut });
        } catch (err) {
            toastError("Booking failed", {
                description: "The result is unknown. Retry with the same dates or check My Hotel Bookings.",
            });
            setBookingStatus((prev) => ({
                ...prev,
                [`${hotelId}-${roomTypeId}`]: "error",
            }));
        } finally {
            pending.dismiss();
        }
    };

    // Render the room types of one hotel.
    const renderRoomTypes = (hotel: Hotel) => {
        if (!hotel.roomTypes || hotel.roomTypes.length === 0) {
            return (
                <p className="muted">
                    No available rooms for this hotel.
                </p>
            );
        }

        const datesSelected = checkIn && checkOut; // Check if both dates are selected

        return (
            <div className="mt-4 space-y-3">
                <h3 className="font-semibold text-lg text-gray-900 dark:text-zinc-100">Room options</h3>
                {hotel.roomTypes.map((roomType) => {
                    const bookingKey = `${hotel.id}-${roomType.id}`;
                    const isBooking = bookingStatus[bookingKey] === "loading";
                    const available = availabilityStay === `${checkIn}/${checkOut}` ? roomType.availableRooms : null;
                    const isBooked = bookingStatus[bookingKey] === "success";

                    return (
                        <div
                            key={roomType.id}
                            className="p-3 rounded-lg border border-gray-300 bg-white dark:border-white/10 dark:bg-white/5"
                        >
                            <div className="hotel-room-summary flex justify-between gap-4">
                                <div>
                                    <p className="font-medium text-gray-900 dark:text-zinc-100">
                                        {roomType.name}
                                    </p>
                                    {/* `amenities` is the descriptive field the
                                        API actually returns; there is no
                                        `description` on a room type. */}
                                    {roomType.amenities && (
                                        <p className="text-sm text-gray-600 dark:text-zinc-400">
                                            {roomType.amenities}
                                        </p>
                                    )}
                                    <p className="text-sm text-gray-700 dark:text-zinc-300">
                                        <span className="font-medium">
                                            Available:
                                        </span>{" "}
                                        {available == null ? "Select dates for availability" : `${available} ${available === 1 ? "room" : "rooms"} available for your stay`}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-lg text-gray-900 dark:text-zinc-100">
                                        ${roomType.pricePerNight.toFixed(2)} USD/night
                                    </p>
                                    {nights > 0 && (
                                        <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                                            {available == null ? "Estimated " : ""}
                                            ${(available == null ? roomType.pricePerNight * nights : roomType.stayTotal ?? roomType.pricePerNight * nights).toFixed(2)} USD{" "}
                                            total for {nights}{" "}
                                            {nights === 1 ? "night" : "nights"}
                                        </p>
                                    )}
                                    {datesSelected && ( // Only show button if dates are selected
                                        <button
                                            onClick={() =>
                                                handleBookRoom(
                                                    hotel.id,
                                                    roomType.id
                                                )
                                            }
                                            disabled={
                                                (available ?? 0) <=
                                                    0 ||
                                                isBooking ||
                                                isBooked
                                            }
                                            className={`mt-2 px-4 py-1 rounded text-white transition-colors ${
                                                (available ?? 0) <=
                                                0
                                                    ? "bg-gray-400 cursor-not-allowed dark:bg-zinc-600 dark:text-zinc-300"
                                                    : isBooked
                                                    ? "bg-green-600 cursor-not-allowed dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-1 dark:ring-emerald-500/40"
                                                    : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                                            }`}
                                        >
                                            {isBooking
                                                ? "Booking..."
                                                : available == null
                                                ? "Search selected dates"
                                                : isBooked
                                                ? "Booked!"
                                                : (available ?? 0) <=
                                                  0
                                                ? "Unavailable"
                                                : "Book Now"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };
    
    return (
        <div className="page-shell card">
            <BookingSteps current="reserve" />
            <h1 className="text-3xl font-bold mb-6 heading">
                Find your place to stay
            </h1>
            <p className="search-intro">Choose your dates to see availability for your entire stay, nightly rates and the total in USD.</p>

            {/* Search form */}
            <form
                onSubmit={handleSubmit}
                className="search-form mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
                <LocationCombobox label="Destination" kind="cities" value={city} onChange={setCity} placeholder="Which city?" />
                <div className="flex flex-col">
                    <label htmlFor="check-in" className="label mb-1">Check-in:</label>
                    <input
                        id="check-in"
                        type="date"
                        value={checkIn}
                        min={today.toISOString().slice(0, 10)}
                        max={latestCheckIn}
                        onChange={(e) => setCheckIn(e.target.value)}
                        required
                        className="field"
                    />
                </div>
                <div className="flex flex-col">
                    <label htmlFor="check-out" className="label mb-1">
                        Check-out:
                    </label>
                    <input
                        id="check-out"
                        type="date"
                        min={checkIn ? addDays(new Date(`${checkIn}T00:00:00Z`), 1).toISOString().slice(0, 10) : addDays(today, 1).toISOString().slice(0, 10)}
                        max={latestCheckOut}
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                        required
                        className="field"
                    />
                </div>
                <details className="sm:col-span-3">
                    <summary className="text-sm font-semibold cursor-pointer text-blue-600 dark:text-blue-300">Refine your stay</summary>
                    <div className="grid sm:grid-cols-2 gap-4 mt-4">
                        <div><label className="label" htmlFor="hotel-name-filter">Hotel name</label><input className="field" id="hotel-name-filter" value={filters.name} onChange={event => setFilters({ ...filters, name: event.target.value })} placeholder="Any hotel" /></div>
                        <div><label className="label" htmlFor="hotel-rating-filter">Star rating</label><select className="field" id="hotel-rating-filter" value={filters.starRating} onChange={event => setFilters({ ...filters, starRating: event.target.value })}><option value="">Any rating</option>{[1,2,3,4,5].map(rating => <option key={rating} value={rating}>{rating} stars</option>)}</select></div>
                        <div><label className="label" htmlFor="hotel-min-price">Minimum nightly rate (USD)</label><input className="field" id="hotel-min-price" type="number" min="0" step="0.01" value={filters.priceMin} onChange={event => setFilters({ ...filters, priceMin: event.target.value })} placeholder="No minimum" /></div>
                        <div><label className="label" htmlFor="hotel-max-price">Maximum nightly rate (USD)</label><input className="field" id="hotel-max-price" type="number" min="0" step="0.01" value={filters.priceMax} onChange={event => setFilters({ ...filters, priceMax: event.target.value })} placeholder="No maximum" /></div>
                    </div>
                    <p className="text-xs muted mt-3">Shows properties with at least one room in your nightly budget. Review each room’s full stay total below.</p>
                </details>
                <div className="sm:col-span-3 flex gap-2">
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                    >
                        {loading ? "Searching stays…" : "Search stays"}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setCity(""); setCheckIn(""); setCheckOut(""); setBookingStatus({}); setFilters(EMPTY_HOTEL_FILTERS);
                            void loadHotels("", "", "", EMPTY_HOTEL_FILTERS);
                        }}
                        className="flex-1 py-3 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:ring-1 dark:ring-white/10"
                    >
                        Show All
                    </button>
                </div>
            </form>

            {lastReservation && <div role="status" className="surface p-5 mb-6"><p className="font-semibold heading">Your stay is reserved</p><p className="muted text-sm mt-1">Reservation #{lastReservation.id} · {lastReservation.checkIn} to {lastReservation.checkOut}. Add this reservation to an itinerary to review and confirm your demo trip.</p><div className="flex flex-wrap gap-3 mt-4"><Link className="button-primary" href="/itineraries/new">Build an itinerary</Link><Link className="button-secondary" href={`/user/hotel-bookings/${lastReservation.id}`}>View reservation</Link></div></div>}
            {/* Loading and error states */}
            {loading && <p role="status" className="muted">Loading hotels...</p>}
            {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}

            {/* Hotel results */}
            {hotels.length > 0 && (
                <div>
                    <h2 className="text-2xl font-semibold mb-4 heading">
                        {city || checkIn || checkOut
                            ? "Search Results"
                            : "All Hotels"}
                    </h2>
                    <ul className="space-y-6">
                        {hotels.map((hotel) => (
                            <li
                                key={hotel.id}
                                className="p-6 surface"
                            >
                                {hotel.images?.[0] && <img src={hotel.images[0]} alt={hotel.name} loading="lazy" className="w-full h-48 sm:h-64 object-cover rounded-xl mb-5" />}
                                <div className="flex flex-wrap gap-4 justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-xl font-semibold text-gray-800 dark:text-zinc-100">
                                            {hotel.name}
                                        </h3>
                                        <p className="text-gray-600 dark:text-zinc-400">
                                            {hotel.address}
                                        </p>
                                        <p className="text-gray-600 dark:text-zinc-400">
                                            {hotel.location}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <div className="text-right mb-2">
                                            <p className="text-gray-800 dark:text-zinc-200">
                                                <span className="text-yellow-500 dark:text-yellow-400">
                                                    {renderStars(
                                                        hotel.starRating
                                                    )}
                                                </span>
                                            </p>
                                        </div>
                                        <Link
                                            href={`/hotels/${hotel.id}${checkIn && checkOut ? `?${new URLSearchParams({checkIn,checkOut})}` : ""}`}
                                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors text-sm dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                                        >
                                            View Details
                                        </Link>
                                    </div>
                                </div>
                                {renderRoomTypes(hotel)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* No results message */}
            {!loading && !error && hotels.length === 0 && (
                <p className="text-center muted py-4">
                    No stays found. Try another city or different dates.
                </p>
            )}
        </div>
    );
}
