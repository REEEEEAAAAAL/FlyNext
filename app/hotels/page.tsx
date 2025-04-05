"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Hotel interfaces
interface Hotel {
    id: string;
    name: string;
    address: string;
    location: string;
    starRating: number;
    roomTypes: RoomType[];
}

interface RoomType {
    id: string;
    name: string;
    description: string;
    pricePerNight: number;
    capacity: number;
    currentAvailability: number;
}

interface City {
    id: number;
    name: string;
    country: string;
}

export default function HotelSearchPage() {
    const router = useRouter();
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
        if (!checkIn || !checkOut) return 0;
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const timeDiff = Math.abs(
            checkOutDate.getTime() - checkInDate.getTime()
        );
        return Math.ceil(timeDiff / (1000 * 3600 * 24));
    };

    const nights = calculateNights();

    // Book hotel room directly
    const handleBookRoom = async (hotelId: string, roomTypeId: string) => {
        if (!ensureLoggedIn()) return;

        setBookingStatus((prev) => ({
            ...prev,
            [`${hotelId}-${roomTypeId}`]: "loading",
        }));

        const token = localStorage.getItem("accessToken");
        try {
            const res = await fetch("/api/hotels/book", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    hotelId,
                    roomTypeId,
                    checkIn,
                    checkOut,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                alert("Booking failed: " + (data.message || "Unknown error"));
                setBookingStatus((prev) => ({
                    ...prev,
                    [`${hotelId}-${roomTypeId}`]: "error",
                }));
            } else {
                const data = await res.json();

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
                alert(
                    "Hotel booking successful! Reservation ID: " +
                        data.reservation.id
                );
                setBookingStatus((prev) => ({
                    ...prev,
                    [`${hotelId}-${roomTypeId}`]: "success",
                }));
            }
        } catch (err) {
            alert("An error occurred while booking the hotel.");
            setBookingStatus((prev) => ({
                ...prev,
                [`${hotelId}-${roomTypeId}`]: "error",
            }));
        }
    };

    // Render room types for a hotel
    // Render room types for a hotel
    const renderRoomTypes = (hotel: Hotel) => {
        if (!hotel.roomTypes || hotel.roomTypes.length === 0) {
            return (
                <p className="text-gray-500">
                    No available rooms for this hotel.
                </p>
            );
        }

        const datesSelected = checkIn && checkOut; // Check if both dates are selected

        return (
            <div className="mt-4 space-y-3">
                <h3 className="font-semibold text-lg">Available Room Types:</h3>
                {hotel.roomTypes.map((roomType) => {
                    const bookingKey = `${hotel.id}-${roomType.id}`;
                    const isBooking = bookingStatus[bookingKey] === "loading";
                    const isBooked = bookingStatus[bookingKey] === "success";

                    return (
                        <div
                            key={roomType.id}
                            className="p-3 border border-gray-300 rounded bg-white"
                        >
                            <div className="flex justify-between">
                                <div>
                                    <p className="font-medium text-gray-900">
                                        {roomType.name}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        {roomType.description}
                                    </p>
                                    <p className="text-sm">
                                        <span className="font-medium">
                                            Capacity:
                                        </span>{" "}
                                        {roomType.capacity}{" "}
                                        {roomType.capacity === 1
                                            ? "person"
                                            : "people"}
                                    </p>
                                    <p className="text-sm">
                                        <span className="font-medium">
                                            Available:
                                        </span>{" "}
                                        {roomType.currentAvailability} rooms
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-lg">
                                        ${roomType.pricePerNight}/night
                                    </p>
                                    {nights > 0 && (
                                        <p className="text-sm font-medium text-gray-700">
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
                                            className={`mt-2 px-4 py-1 rounded text-white ${
                                                roomType.currentAvailability <=
                                                0
                                                    ? "bg-gray-400 cursor-not-allowed"
                                                    : isBooked
                                                    ? "bg-green-600 cursor-not-allowed"
                                                    : "bg-blue-600 hover:bg-blue-700"
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
        <div className="max-w-4xl mx-auto p-8 bg-white text-black shadow-md rounded">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">
                Hotel Search
            </h1>

            {/* Search form */}
            <form
                onSubmit={handleSubmit}
                className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
                <div className="relative flex flex-col">
                    <label className="text-gray-700 mb-1">City:</label>
                    <input
                        type="text"
                        value={city}
                        onChange={handleCityChange}
                        placeholder="e.g., Toronto"
                        required
                        className="border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500 text-black"
                        onFocus={() =>
                            city.length >= 2 && setShowCityDropdown(true)
                        }
                        onBlur={() =>
                            setTimeout(() => setShowCityDropdown(false), 150)
                        }
                    />
                    {showCityDropdown && citySuggestions.length > 0 && (
                        <ul className="absolute z-10 bg-white border border-gray-300 w-full max-h-60 overflow-y-auto top-full text-gray-900">
                            {citySuggestions.map((suggestion) => (
                                <li
                                    key={suggestion.id}
                                    onClick={() =>
                                        selectCitySuggestion(suggestion)
                                    }
                                    className="p-2 hover:bg-gray-200 cursor-pointer"
                                >
                                    {suggestion.name} ({suggestion.country})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="flex flex-col">
                    <label className="text-gray-700 mb-1">Check-In Date:</label>
                    <input
                        type="date"
                        value={checkIn}
                        onChange={(e) => setCheckIn(e.target.value)}
                        required
                        className="border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500 text-black"
                    />
                </div>
                <div className="flex flex-col">
                    <label className="text-gray-700 mb-1">
                        Check-Out Date:
                    </label>
                    <input
                        type="date"
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                        required
                        className="border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500 text-black"
                    />
                </div>
                <div className="sm:col-span-3 flex gap-2">
                    <button
                        type="submit"
                        className="flex-1 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors"
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
                        className="flex-1 py-3 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
                    >
                        Show All
                    </button>
                </div>
            </form>

            {/* Loading and error states */}
            {loading && <p className="text-gray-600">Loading hotels...</p>}
            {error && <p className="text-red-600">{error}</p>}

            {/* Hotel results */}
            {hotels.length > 0 && (
                <div>
                    <h2 className="text-2xl font-semibold mb-4 text-gray-800">
                        {city || checkIn || checkOut
                            ? "Search Results"
                            : "All Hotels"}
                    </h2>
                    <ul className="space-y-6">
                        {hotels.map((hotel) => (
                            <li
                                key={hotel.id}
                                className="p-6 border border-gray-300 rounded bg-gray-50"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-xl font-semibold text-gray-800">
                                            {hotel.name}
                                        </h3>
                                        <p className="text-gray-600">
                                            {hotel.address}
                                        </p>
                                        <p className="text-gray-600">
                                            {hotel.location}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <div className="text-right mb-2">
                                            <p className="text-gray-800">
                                                <span className="text-yellow-500">
                                                    {renderStars(
                                                        hotel.starRating
                                                    )}
                                                </span>
                                            </p>
                                        </div>
                                        <Link
                                            href={`/hotels/${hotel.id}`}
                                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors text-sm"
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
                <p className="text-center text-gray-600 py-4">
                    No hotels found.
                </p>
            )}
        </div>
    );
}
