"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface FlightBooking {
    id: number;
    afsBookingId: string;
    status: string;
    price: number;
    departure: {
        goDate: string;
        returnDate: string;
        goAirport: string;
        returnAirport: string;
    };
    arrival: {
        goDate: string;
        returnDate: string;
        goAirport: string;
        returnAirport: string;
    };
    createdAt: string;
}

export default function UserFlightBookingsPage() {
    const router = useRouter();
    const [bookings, setBookings] = useState<FlightBooking[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const refreshToken = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }
        const response = await fetch("/api/user", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 401) {
            // Token expired or invalid - try refreshing
            localStorage.removeItem("accessToken");

            // Instead of going directly to login, go to refresh page
            router.push("/auth/refresh");
            return;
        }
    };
    useEffect(() => {
        // Protect the page: if no access token is found, redirect to login.
        const token = localStorage.getItem("accessToken");
        if (!token) {
            // Redirect to login if no token found.
            router.push("/auth/login");
            return;
        }

        refreshToken();

        const fetchData = async () => {
            const response = await fetch("/api/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.status === 401) {
                // Token expired or invalid - try refreshing
                localStorage.removeItem("accessToken");
                router.push("/auth/refresh");
                return;
            }
        };

        const fetchBookings = async () => {
            setLoading(true);
            setError("");
            try {
                const res = await fetch("/api/user/flight-bookings", {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: token ? `Bearer ${token}` : "",
                    },
                });
                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || "Failed to fetch flight bookings.");
                } else {
                    const data = await res.json();
                    setBookings(data.bookings || []);
                }
            } catch (err) {
                setError("An error occurred while fetching flight bookings.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        fetchBookings();
    }, [router]);

    const formatDate = (dateString: string) => {
        if (!dateString || dateString === " ") return "N/A";
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    return (
        <div className="max-w-6xl mx-auto p-8 bg-white text-black shadow-md rounded">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">
                Your Flight Bookings
            </h1>
            {loading && (
                <p className="text-gray-600">Loading flight bookings...</p>
            )}
            {error && <p className="text-red-600">{error}</p>}
            {bookings.length > 0 ? (
                <div className="space-y-4">
                    {bookings.map((booking) => (
                        <div
                            key={booking.id}
                            className="p-6 border border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">
                                        Booking #{booking.afsBookingId}
                                    </h2>
                                    <p className="text-gray-600 mb-1">
                                        <span className="font-medium">
                                            Status:
                                        </span>{" "}
                                        <span
                                            className={`px-2 py-1 rounded text-xs ${
                                                booking.status === "CONFIRMED"
                                                    ? "bg-green-100 text-green-800"
                                                    : booking.status ===
                                                      "PENDING"
                                                    ? "bg-yellow-100 text-yellow-800"
                                                    : "bg-red-100 text-red-800"
                                            }`}
                                        >
                                            {booking.status}
                                        </span>
                                    </p>
                                    <p className="text-gray-600 mb-1">
                                        <span className="font-medium">
                                            Price:
                                        </span>{" "}
                                        ${booking.price.toFixed(2)}
                                    </p>
                                    <p className="text-gray-600 mb-1">
                                        <span className="font-medium">
                                            Booked on:
                                        </span>{" "}
                                        {formatDate(booking.createdAt)}
                                    </p>
                                </div>
                                <Link
                                    href={`/user/flight-bookings/${booking.id}`}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                >
                                    View Details
                                </Link>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-3 bg-blue-50 rounded">
                                    <h3 className="font-medium text-blue-800 mb-2">
                                        Departure
                                    </h3>
                                    <p className="text-gray-700">
                                        <span className="font-medium">
                                            Outbound:
                                        </span>{" "}
                                        {formatDate(booking.departure.goDate)} -{" "}
                                        {booking.departure.goAirport}
                                    </p>
                                    {booking.departure.returnDate &&
                                        booking.departure.returnDate && (
                                            <p className="text-gray-700">
                                                <span className="font-medium">
                                                    Return:
                                                </span>{" "}
                                                {formatDate(
                                                    booking.departure.returnDate
                                                )}{" "}
                                                -{" "}
                                                {
                                                    booking.departure
                                                        .returnAirport
                                                }
                                            </p>
                                        )}
                                </div>
                                <div className="p-3 bg-green-50 rounded">
                                    <h3 className="font-medium text-green-800 mb-2">
                                        Arrival
                                    </h3>
                                    <p className="text-gray-700">
                                        <span className="font-medium">
                                            Outbound:
                                        </span>{" "}
                                        {formatDate(booking.arrival.goDate)} -{" "}
                                        {booking.arrival.goAirport}
                                    </p>
                                    {booking.arrival.returnDate &&
                                        booking.arrival.returnDate !== " " && (
                                            <p className="text-gray-700">
                                                <span className="font-medium">
                                                    Return:
                                                </span>{" "}
                                                {formatDate(
                                                    booking.arrival.returnDate
                                                )}{" "}
                                                -{" "}
                                                {booking.arrival.returnAirport}
                                            </p>
                                        )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                !loading && (
                    <p className="text-gray-600">No flight bookings found.</p>
                )
            )}
        </div>
    );
}
