"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

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
        type: string;
        amenities: string; // Changed from string[] to string
    };
    createdAt: string;
}

export default function HotelBookingDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const [booking, setBooking] = useState<HotelBookingDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [actionLoading, setActionLoading] = useState(false);
    const [actionMessage, setActionMessage] = useState("");

    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

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
                    localStorage.removeItem("accessToken");
                    router.push("/auth/refresh");
                    return;
                }

                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || "Failed to fetch booking details.");
                } else {
                    const data = await res.json();
                    setBooking(data.booking);
                }
            } catch (err) {
                setError("An error occurred while fetching booking details.");
            } finally {
                setLoading(false);
            }
        };

        fetchBooking();
    }, [params.bookingId, router]);

    const formatDate = (dateString: string) => {
        if (!dateString) return "N/A";
        const date = new Date(dateString);
        return date.toLocaleDateString();
    };

    const parseAmenities = (amenitiesString: string) => {
        if (!amenitiesString) return [];
        try {
            // remove the quotes ""
            amenitiesString = amenitiesString.replace(/^"|"$/g, "");
            // Try to parse as JSON first (if it was stored as JSON string)
            const parsed = JSON.parse(amenitiesString);
            if (Array.isArray(parsed)) return parsed;
            // If not JSON, try splitting by comma
            return amenitiesString.split(",").map((item) => item.trim());
        } catch {
            // If parsing fails, return as single item array
            return [amenitiesString];
        }
    };

    const handleCancelBooking = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        if (!confirm("Are you sure you want to cancel this booking?")) {
            return;
        }

        setActionLoading(true);
        setActionMessage("");

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
                localStorage.removeItem("accessToken");
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Cancellation failed");
            }

            setActionMessage(data.message || "Booking cancelled successfully");

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
            }
        } catch (err) {
            setActionMessage(
                err instanceof Error ? err.message : "Failed to cancel booking"
            );
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) return <div className="max-w-4xl mx-auto p-8">Loading...</div>;
    if (error)
        return (
            <div className="max-w-4xl mx-auto p-8 text-red-600">{error}</div>
        );
    if (!booking)
        return <div className="max-w-4xl mx-auto p-8">Booking not found</div>;

    const amenities = parseAmenities(booking.room.amenities);

    return (
        <div className="max-w-4xl mx-auto p-8 bg-white text-black shadow-md rounded">
            <div className="mb-6">
                <Link
                    href="/user/hotel-bookings"
                    className="text-blue-600 hover:underline"
                >
                    &larr; Back to all bookings
                </Link>
            </div>

            <h1 className="text-3xl font-bold mb-6 text-gray-800">
                Hotel Booking Details
            </h1>

            <div className="space-y-6">
                <div className="p-6 border border-gray-300 rounded bg-gray-50">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-semibold">
                                {booking.hotel.name}
                            </h2>
                            <p className="text-gray-600">
                                {booking.hotel.address}
                            </p>
                        </div>
                        <div className="text-right">
                            <p
                                className={`text-lg font-semibold ${
                                    booking.status === "CONFIRMED"
                                        ? "text-green-600"
                                        : booking.status === "CANCELLED"
                                        ? "text-red-600"
                                        : "text-yellow-600"
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
                        <div className="border border-gray-200 p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 text-gray-800">
                                Check-In
                            </h3>
                            <p className="text-gray-700">
                                {formatDate(booking.checkIn)}
                            </p>
                        </div>

                        <div className="border border-gray-200 p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 text-gray-800">
                                Check-Out
                            </h3>
                            <p className="text-gray-700">
                                {formatDate(booking.checkOut)}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="border border-gray-200 p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 text-gray-800">
                                Room Details
                            </h3>
                            <p className="text-gray-700 mb-2">
                                <span className="font-medium">Type:</span>{" "}
                                {booking.room.type}
                            </p>
                            {amenities.length > 0 && (
                                <div>
                                    <p className="font-medium text-gray-700 mb-1">
                                        Amenities:
                                    </p>
                                    <ul className="list-disc list-inside text-gray-700">
                                        {amenities.map((amenity, index) => (
                                            <li key={index}>{amenity}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div className="border border-gray-200 p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 text-gray-800">
                                Hotel Location
                            </h3>
                            <p className="text-gray-700">
                                {booking.hotel.location}
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-200">
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
                                        : "bg-red-600 hover:bg-red-700"
                                } text-white disabled:bg-gray-300 disabled:cursor-not-allowed`}
                            >
                                {actionLoading
                                    ? "Cancelling..."
                                    : "Cancel Booking"}
                            </button>
                        </div>
                        {actionMessage && (
                            <p
                                className={`text-sm ${
                                    actionMessage.includes("failed")
                                        ? "text-red-600"
                                        : "text-green-600"
                                }`}
                            >
                                {actionMessage}
                            </p>
                        )}
                        <p className="text-sm text-gray-500">
                            Booking created: {formatDate(booking.createdAt)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
