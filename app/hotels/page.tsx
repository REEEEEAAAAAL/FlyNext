"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFeedback } from "@/app/context/FeedbackContext";
import { stayNights } from "@/app/lib/booking-display";

// Hotel interfaces
interface Hotel {
    id: number;
    name: string;
    address: string;
    location: string;
    starRating: number;
    roomTypes: RoomType[];
}

interface RoomType {
    id: number;
    name: string;
    amenities: string | null;
    pricePerNight: number;
    currentAvailability: number;
}

interface City {
    id: number;
    name: string;
    country: string;
}

export default function HotelSearchPage() {
    const router = useRouter();
    const { success, error: toastError, warning, info } = useFeedback();
    const [city, setCity] = useState("");
    const [checkIn, setCheckIn] = useState("");
    const [checkOut, setCheckOut] = useState("");
    const [hotels, setHotels] = useState<Hotel[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [bookingStatus, setBookingStatus] = useState<{
        [key: string]: "idle" | "loading" | "success" | "error";
    }>({});

    // Auto-suggest state for cities
    const [citySuggestions, setCitySuggestions] = useState<City[]>([]);
    const [showCityDropdown, setShowCityDropdown] = useState(false);

    // Fetch all hotels on initial load
    useEffect(() => {
        const fetchAllHotels = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/hotels`, {
                    method: "GET",
                });

                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || "Error fetching hotels.");
                } else {
                    const data = await res.json();
                    setHotels(data.hotels || []);
                }
            } catch (err) {
                setError("An error occurred while fetching hotels.");
            } finally {
                setLoading(false);
            }
        };

        fetchAllHotels();
    }, []);

    // Redirect to login if not logged in
    const ensureLoggedIn = (): boolean => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return false;
        }
        return true;
    };

    // Fetch city suggestions from the backend
    const fetchCitySuggestions = async (query: string): Promise<City[]> => {
        try {
            const res = await fetch(
                `/api/locations/cities?q=${encodeURIComponent(query)}`,
                {
                    method: "GET",
                    headers: { "Content-Type": "application/json" },
                }
            );
            if (res.ok) {
                const data = await res.json();
                return data.cities || [];
            }
        } catch (err) {
            console.error("Error fetching city suggestions:", err);
        }
        return [];
    };

    const handleCityChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setCity(value);
        if (value.length >= 2) {
            const suggestions = await fetchCitySuggestions(value);
            setCitySuggestions(suggestions);
            setShowCityDropdown(true);
        } else {
            setCitySuggestions([]);
            setShowCityDropdown(false);
        }
    };

    const selectCitySuggestion = (selectedCity: City) => {
        setCity(selectedCity.name);
        setCitySuggestions([]);
        setShowCityDropdown(false);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        setBookingStatus({});

        try {
            const query = new URLSearchParams({
                city,
                checkIn,
                checkOut,
            }).toString();

            const res = await fetch(`/api/hotels?${query}`, {
                method: "GET",
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error || "Error fetching hotels.");
            } else {
                const data = await res.json();
                setHotels(data.hotels || []);
            }
        } catch (err) {
            setError("An error occurred while searching for hotels.");
        } finally {
            setLoading(false);
        }
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
        if (!ensureLoggedIn()) return;

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

        setBookingStatus((prev) => ({
            ...prev,
            [`${hotelId}-${roomTypeId}`]: "loading",
        }));

        // A pinned toast: this one is resolved by the outcome below rather than by
        // a timer, so a slow booking still says what is happening.
        const pending = info("Reserving your room…", { duration: 0 });

        const token = localStorage.getItem("accessToken");
        try {
            const res = await fetch("/api/hotels/book", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                // The API reads these two ids with `readString` before parsing
                // them as positive integers, so they must be sent as JSON
                // strings: a raw number is rejected with
                // `Field "hotelId" must be a string`.
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
                        data?.error || data?.message || "Unknown error",
                });
                setBookingStatus((prev) => ({
                    ...prev,
                    [`${hotelId}-${roomTypeId}`]: "error",
                }));
                return;
            }

            const data = await res.json();

            try {
                const query = new URLSearchParams({
                    city,
                    checkIn,
                    checkOut,
                }).toString();

                const refresh = await fetch(`/api/hotels?${query}`, {
                    method: "GET",
                });

                if (!refresh.ok) {
                    const failure = await refresh.json().catch(() => null);
                    setError(failure?.error || "Error fetching hotels.");
                } else {
                    const refreshed = await refresh.json();
                    setHotels(refreshed.hotels || []);
                }
            } catch (err) {
                setError("An error occurred while searching for hotels.");
            } finally {
                setLoading(false);
            }

            success("Room booked", {
                description: `Reservation #${data.reservation.id} is confirmed for ${nights} ${
                    nights === 1 ? "night" : "nights"
                }. Add it to an itinerary from the itineraries page.`,
            });
            setBookingStatus((prev) => ({
                ...prev,
                [`${hotelId}-${roomTypeId}`]: "success",
            }));
        } catch (err) {
            toastError("Booking failed", {
                description: "An error occurred while booking the hotel.",
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
                <h3 className="font-semibold text-lg text-gray-900 dark:text-zinc-100">Available Room Types:</h3>
                {hotel.roomTypes.map((roomType) => {
                    const bookingKey = `${hotel.id}-${roomType.id}`;
                    const isBooking = bookingStatus[bookingKey] === "loading";
                    const isBooked = bookingStatus[bookingKey] === "success";

                    return (
                        <div
                            key={roomType.id}
                            className="p-3 rounded-lg border border-gray-300 bg-white dark:border-white/10 dark:bg-white/5"
                        >
                            <div className="flex justify-between">
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
                                        {roomType.currentAvailability} rooms
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-lg text-gray-900 dark:text-zinc-100">
                                        ${roomType.pricePerNight}/night
                                    </p>
                                    {nights > 0 && (
                                        <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                                            ${roomType.pricePerNight * nights}{" "}
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
                                                roomType.currentAvailability <=
                                                    0 ||
                                                isBooking ||
                                                isBooked
                                            }
                                            className={`mt-2 px-4 py-1 rounded text-white transition-colors ${
                                                roomType.currentAvailability <=
                                                0
                                                    ? "bg-gray-400 cursor-not-allowed dark:bg-zinc-600 dark:text-zinc-300"
                                                    : isBooked
                                                    ? "bg-green-600 cursor-not-allowed dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-1 dark:ring-emerald-500/40"
                                                    : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                                            }`}
                                        >
                                            {isBooking
                                                ? "Booking..."
                                                : isBooked
                                                ? "Booked!"
                                                : roomType.currentAvailability <=
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
        <div className="max-w-4xl mx-auto p-8 card">
            <h1 className="text-3xl font-bold mb-6 heading">
                Hotel Search
            </h1>

            {/* Search form */}
            <form
                onSubmit={handleSubmit}
                className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
                <div className="relative flex flex-col">
                    <label className="label mb-1">City:</label>
                    <input
                        type="text"
                        value={city}
                        onChange={handleCityChange}
                        placeholder="e.g., Toronto"
                        required
                        className="field"
                        onFocus={() =>
                            city.length >= 2 && setShowCityDropdown(true)
                        }
                        onBlur={() =>
                            setTimeout(() => setShowCityDropdown(false), 150)
                        }
                    />
                    {showCityDropdown && citySuggestions.length > 0 && (
                        <ul className="absolute z-10 w-full max-h-60 overflow-y-auto top-full floating">
                            {citySuggestions.map((suggestion) => (
                                <li
                                    key={suggestion.id}
                                    onClick={() =>
                                        selectCitySuggestion(suggestion)
                                    }
                                    className="p-2 cursor-pointer row-hover"
                                >
                                    {suggestion.name} ({suggestion.country})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="flex flex-col">
                    <label className="label mb-1">Check-In Date:</label>
                    <input
                        type="date"
                        value={checkIn}
                        onChange={(e) => setCheckIn(e.target.value)}
                        required
                        className="field"
                    />
                </div>
                <div className="flex flex-col">
                    <label className="label mb-1">
                        Check-Out Date:
                    </label>
                    <input
                        type="date"
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                        required
                        className="field"
                    />
                </div>
                <div className="sm:col-span-3 flex gap-2">
                    <button
                        type="submit"
                        className="flex-1 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                    >
                        Search Hotels
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setCity("");
                            setCheckIn("");
                            setCheckOut("");
                            setError("");
                            setLoading(true);
                            fetch(`/api/hotels`)
                                .then((res) => res.json())
                                .then((data) => {
                                    setHotels(data.hotels || []);
                                    setLoading(false);
                                })
                                .catch((err) => {
                                    setError("Error fetching all hotels");
                                    setLoading(false);
                                });
                        }}
                        className="flex-1 py-3 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:ring-1 dark:ring-white/10"
                    >
                        Show All
                    </button>
                </div>
            </form>

            {/* Loading and error states */}
            {loading && <p className="muted">Loading hotels...</p>}
            {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

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
                                <div className="flex justify-between items-start mb-4">
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
                                            href={`/hotels/${hotel.id}`}
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
            {!loading && hotels.length === 0 && (
                <p className="text-center muted py-4">
                    No hotels found.
                </p>
            )}
        </div>
    );
}
