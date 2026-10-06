"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import { formatLegDate, hotelReference, stayNights } from "@/app/lib/booking-display";
import { useFeedback } from "@/app/context/FeedbackContext";

interface HotelBooking {
    id: number;
    /** Short, passenger-facing reference derived from the reservation id. */
    reference: string;
    hotelName: string;
    hotelLocation: string;
    roomTypeName?: string;
    checkIn: string;
    checkOut: string;
    price: number;
    status: string;
}

export default function UserHotelBookingsPage() {
    const router = useRouter();
    const { error: showError } = useFeedback();
    const [bookings, setBookings] = useState<HotelBooking[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    /**
     * Validate the session before the page shows anything.
     *
     * A stored token is not necessarily a usable one, and the booking list
     * endpoints answer `401` rather than redirecting. Probing `/api/user` first
     * means an expired session starts the refresh flow immediately instead of
     * leaving the traveller on a page whose only content is "Unauthorized".
     */
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
            clearAccessToken();

            // Instead of going directly to login, go to refresh page
            router.push("/auth/refresh");
            return;
        }
    };

    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }
        refreshToken();

        const fetchHotelBookings = async () => {
            setLoading(true);
            setError("");
            try {
                /*
                 * `includeCancelled=1`: this is the traveller's own history, so a
                 * stay they cancelled belongs on it. The itinerary builder is the
                 * page that must not be offered cancelled reservations, and it
                 * omits the flag.
                 */
                const res = await fetch(
                    "/api/user/hotel-bookings?includeCancelled=1",
                    {
                        method: "GET",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: token ? `Bearer ${token}` : "",
                        },
                    }
                );

                if (!res.ok) {
                    const data = await res.json();
                    const failure = data.error || "Failed to fetch hotel bookings.";
                    setError(failure);
                    showError("Could not load your hotel bookings", {
                        description: failure,
                    });
                } else {
                    const data = await res.json();
                    setBookings(
                        data.bookings.map((b: any) => ({
                            id: b.id,
                            reference: hotelReference(b.id),
                            status: b.status,
                            hotelName: b.hotel.name,
                            hotelLocation: b.hotel.location,
                            roomTypeName: b.roomType?.name,
                            checkIn: b.period.checkIn,
                            checkOut: b.period.checkOut,
                            price: b.totalPrice,
                        })) || []
                    );
                }
            } catch (err) {
                const failure = "An error occurred while fetching hotel bookings.";
                setError(failure);
                showError("Could not load your hotel bookings", {
                    description: failure,
                });
            } finally {
                setLoading(false);
            }
        };

        fetchHotelBookings();
    }, [router, showError]);

    return (
        <div className="card max-w-6xl mx-auto p-8 text-black dark:text-zinc-100">
            <h1 className="text-3xl font-bold mb-6 heading">
                Your Hotel Bookings
            </h1>
            {loading && (
                <p className="muted">Loading hotel bookings...</p>
            )}
            {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
            {bookings.length > 0 ? (
                <div className="space-y-4">
                    {bookings.map((booking) => {
                        const nights = stayNights(booking.checkIn, booking.checkOut);

                        return (
                            <div
                                key={booking.id}
                                className="p-6 border border-gray-300 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h2 className="text-xl font-semibold mb-2">
                                            Booking #{booking.reference}
                                        </h2>
                                        <p className="muted mb-1">
                                            <span className="font-medium">
                                                Status:
                                            </span>{" "}
                                            <span
                                                className={`px-2 py-1 rounded text-xs ${
                                                    booking.status === "CONFIRMED"
                                                        ? "bg-green-100 text-green-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-1 dark:ring-emerald-500/30"
                                                        : booking.status ===
                                                          "PENDING"
                                                        ? "bg-yellow-100 text-yellow-800 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-1 dark:ring-amber-500/30"
                                                        : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300 dark:ring-1 dark:ring-red-500/30"
                                                }`}
                                            >
                                                {booking.status}
                                            </span>
                                        </p>
                                        {booking.roomTypeName && (
                                            <p className="muted mb-1">
                                                <span className="font-medium">
                                                    Room Type:
                                                </span>{" "}
                                                {booking.roomTypeName}
                                            </p>
                                        )}
                                        <p className="muted mb-1">
                                            <span className="font-medium">
                                                Price:
                                            </span>{" "}
                                            ${booking.price.toFixed(2)}
                                            {nights !== null && (
                                                <span className="muted">
                                                    {" "}
                                                    for {nights}{" "}
                                                    {nights === 1 ? "night" : "nights"}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    <Link
                                        href={`/user/hotel-bookings/${booking.id}`}
                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
                                    >
                                        View Details
                                    </Link>
                                </div>

                                <div className="mt-4">
                                    <h3 className="text-lg font-semibold heading">
                                        {booking.hotelName}
                                    </h3>
                                    {booking.hotelLocation && (
                                        <p className="muted text-sm">
                                            {booking.hotelLocation}
                                        </p>
                                    )}
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded">
                                        <h3 className="font-medium text-blue-800 dark:text-blue-300 mb-2">
                                            Check-In
                                        </h3>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            {formatLegDate(booking.checkIn)}
                                        </p>
                                    </div>
                                    <div className="p-3 bg-green-50 dark:bg-emerald-500/10 rounded">
                                        <h3 className="font-medium text-green-800 dark:text-emerald-300 mb-2">
                                            Check-Out
                                        </h3>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            {formatLegDate(booking.checkOut)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /*
                 * `!error` as well: a failed fetch leaves `bookings` empty, so
                 * without it the page would state "No hotel bookings found."
                 * underneath the red error explaining that the list could not be
                 * loaded at all.
                 */
                !loading && !error && (
                    <p className="muted">No hotel bookings found.</p>
                )
            )}
        </div>
    );
}
