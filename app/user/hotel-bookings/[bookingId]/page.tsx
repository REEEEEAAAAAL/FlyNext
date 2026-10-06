"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import { formatLegDate, hotelReference, stayNights } from "@/app/lib/booking-display";
import { useFeedback } from "@/app/context/FeedbackContext";

interface HotelBookingDetail {
    id: number;
    status: string;
    checkIn: string;
    checkOut: string;
    price: number;
    hotel: {
        name: string;
        address: string;
        location: string;
    };
    room: {
        /*
         * Both are null when the room type has been deleted: the route maps
         * `roomType?.name ?? null` / `?? null`, and the relation is
         * `onDelete: SetNull`. Declaring them as `string` is what let "Type:" render
         * with nothing after it.
         */
        type: string | null;
        amenities: string | null; // One string: a JSON array literal or a comma-separated list.
    };
    createdAt: string;
}

export default function HotelBookingDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const { confirm, success, error: toastError, info } = useFeedback();
    const [booking, setBooking] = useState<HotelBookingDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [actionLoading, setActionLoading] = useState(false);

    /**
     * Validate the session before the page shows anything.
     *
     * A stored token is not necessarily a usable one, and this endpoint answers
     * `401` rather than redirecting. Probing `/api/user` first means an expired
     * session starts the refresh flow immediately instead of rendering "Booking
     * not found" for a booking that exists.
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

        const fetchBooking = async () => {
            setLoading(true);
            setError("");
            try {
                const res = await fetch(
                    `/api/user/hotel-bookings/${params.bookingId}`,
                    {
                        method: "GET",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                if (res.status === 401) {
                    clearAccessToken();
                    router.push("/auth/refresh");
                    return;
                }

                if (!res.ok) {
                    const data = await res.json();
                    const failure = data.error || "Failed to fetch booking details.";
                    setError(failure);
                    toastError("Could not load this booking", {
                        description: failure,
                    });
                } else {
                    const data = await res.json();
                    setBooking(data.booking);
                }
            } catch (err) {
                const failure = "An error occurred while fetching booking details.";
                setError(failure);
                toastError("Could not load this booking", { description: failure });
            } finally {
                setLoading(false);
            }
        };

        fetchBooking();
    }, [params.bookingId, router, toastError]);

    const parseAmenities = (amenitiesString: string | null) => {
        if (!amenitiesString) return [];
        // The only writer stores a comma-separated string (the room-type form's
        // "List amenities (comma separated)" field, and the reference seed), so
        // the split has to be the fallback for a value that is not JSON — not code
        // that sits after `JSON.parse` inside the same `try`, where CSV input
        // throws before reaching it and the whole string rendered as one bullet.
        const trimmed = amenitiesString.replace(/^"|"$/g, "");
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item));
            }
        } catch {
            // Not JSON, which is the normal case.
        }
        return trimmed
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    };

    /**
     * Cancel the stay, after a full-screen confirmation.
     *
     * The dialog states what the traveller is giving up — the nights go back on
     * sale and the itinerary total drops — because `window.confirm("Are you sure
     * you want to cancel this booking?")` neither named the booking nor said what
     * cancelling it would do.
     */
    const handleCancelBooking = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        const reference = booking === null ? "" : hotelReference(booking.id);
        const nights =
            booking === null ? null : stayNights(booking.checkIn, booking.checkOut);
        const stay =
            nights === null
                ? "This stay"
                : `This ${nights}-${nights === 1 ? "night" : "nights"} stay`;

        const confirmed = await confirm({
            title: "Cancel this hotel booking?",
            description: `${stay} at ${
                booking?.hotel.name ?? "the hotel"
            } (Booking #${reference}) will be cancelled. This cannot be undone.`,
            points: [
                "The room is released and those nights can be sold to somebody else.",
                "Any itinerary total that includes this stay is reduced by its price.",
                "Re-booking later means paying whatever the rate is then.",
            ],
            confirmLabel: "Yes, cancel booking",
            cancelLabel: "Keep my booking",
        });
        if (!confirmed) {
            return;
        }

        setActionLoading(true);
        const pending = info("Cancelling your booking…", { duration: 0 });

        try {
            const res = await fetch(
                `/api/user/hotel-bookings/${params.bookingId}`,
                {
                    method: "DELETE",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (res.status === 401) {
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Cancellation failed");
            }

            success("Hotel booking cancelled", {
                description:
                    data.message ||
                    `Booking #${reference} has been cancelled and the room released.`,
            });

            // Refresh booking data
            const bookingRes = await fetch(
                `/api/user/hotel-bookings/${params.bookingId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            if (bookingRes.ok) {
                const bookingData = await bookingRes.json();
                setBooking(bookingData.booking);
            } else {
                // The cancellation itself succeeded, so the local copy is updated
                // rather than left claiming the booking is still CONFIRMED with an
                // enabled Cancel button — pressing it again would re-issue the
                // DELETE for a booking that is already released.
                setBooking((current) =>
                    current === null ? current : { ...current, status: "CANCELLED" }
                );
            }
        } catch (err) {
            toastError("Cancellation failed", {
                description:
                    err instanceof Error ? err.message : "Failed to cancel booking",
            });
        } finally {
            pending.dismiss();
            setActionLoading(false);
        }
    };

    if (loading) return <div className="max-w-4xl mx-auto p-8">Loading...</div>;
    if (error)
        return (
            <div className="max-w-4xl mx-auto p-8 text-red-600 dark:text-red-400">
                {error}
            </div>
        );
    if (!booking)
        return <div className="max-w-4xl mx-auto p-8">Booking not found</div>;

    const amenities = parseAmenities(booking.room.amenities);

    return (
        <div className="card max-w-4xl mx-auto p-8 text-black dark:text-zinc-100">
            <div className="mb-6">
                <Link
                    href="/user/hotel-bookings"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                >
                    &larr; Back to all bookings
                </Link>
            </div>

            <h1 className="text-3xl font-bold mb-6 heading">
                Hotel Booking Details
            </h1>

            <div className="space-y-6">
                <div className="p-6 border border-gray-300 dark:border-white/10 rounded bg-gray-50 dark:bg-white/5">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Booking #{hotelReference(booking.id)}
                            </h2>
                            <p className="muted">
                                {booking.hotel.name} &middot; {booking.hotel.address}
                            </p>
                        </div>
                        <div className="text-right">
                            <p
                                className={`text-lg font-semibold ${
                                    booking.status === "CONFIRMED"
                                        ? "text-green-600 dark:text-emerald-400"
                                        : booking.status === "CANCELLED"
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-yellow-600 dark:text-amber-400"
                                }`}
                            >
                                {booking.status}
                            </p>
                            <p className="text-2xl font-bold">
                                ${booking.price.toFixed(2)}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        <div className="border divider p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 heading">
                                Check-In
                            </h3>
                            <p className="text-gray-700 dark:text-zinc-200">
                                {formatLegDate(booking.checkIn)}
                            </p>
                        </div>

                        <div className="border divider p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 heading">
                                Check-Out
                            </h3>
                            <p className="text-gray-700 dark:text-zinc-200">
                                {formatLegDate(booking.checkOut)}
                            </p>
                            {(() => {
                                const nights = stayNights(
                                    booking.checkIn,
                                    booking.checkOut
                                );
                                return nights === null ? null : (
                                    <p className="muted mt-1 text-sm">
                                        {nights} {nights === 1 ? "night" : "nights"}
                                    </p>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="border divider p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 heading">
                                Room Details
                            </h3>
                            <p className="text-gray-700 dark:text-zinc-200 mb-2">
                                <span className="font-medium">Type:</span>{" "}
                                {booking.room.type ??
                                    "Room type no longer available"}
                            </p>
                            {amenities.length > 0 && (
                                <div>
                                    <p className="font-medium text-gray-700 dark:text-zinc-200 mb-1">
                                        Amenities:
                                    </p>
                                    <ul className="list-disc list-inside text-gray-700 dark:text-zinc-200">
                                        {amenities.map((amenity, index) => (
                                            <li key={index}>{amenity}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div className="border divider p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 heading">
                                Hotel Location
                            </h3>
                            <p className="text-gray-700 dark:text-zinc-200">
                                {booking.hotel.location}
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t divider">
                        <div className="flex flex-wrap gap-4 mb-4">
                            <button
                                onClick={handleCancelBooking}
                                disabled={
                                    actionLoading ||
                                    booking.status === "CANCELLED"
                                }
                                className={`px-4 py-2 rounded-md ${
                                    actionLoading
                                        ? "bg-red-300"
                                        : "bg-red-600 hover:bg-red-700 dark:hover:bg-red-500"
                                } text-white disabled:bg-gray-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed`}
                            >
                                {actionLoading
                                    ? "Cancelling..."
                                    : "Cancel Booking"}
                            </button>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-zinc-400">
                            Booking created: {formatLegDate(booking.createdAt)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
