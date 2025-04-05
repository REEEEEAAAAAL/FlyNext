"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
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

export default function FlightBookingDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const [booking, setBooking] = useState<FlightBooking | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [actionLoading, setActionLoading] = useState({
        verify: false,
        cancel: false,
    });
    const [actionMessage, setActionMessage] = useState({
        verify: "",
        cancel: "",
    });

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
                    `/api/user/flight-bookings/${params.bookingId}`,
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
        if (!dateString || dateString === " ") return "N/A";
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    const handleVerifyFlight = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        setActionLoading((prev) => ({ ...prev, verify: true }));
        setActionMessage((prev) => ({ ...prev, verify: "" }));

        try {
            const res = await fetch(
                `/api/user/flight-bookings/${params.bookingId}`,
                {
                    method: "POST",
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
                throw new Error(data.error || "Verification failed");
            }

            setActionMessage((prev) => ({
                ...prev,
                verify: data.message || "Flight verified successfully",
            }));

            // Refresh booking data
            const bookingRes = await fetch(
                `/api/user/flight-bookings/${params.bookingId}`,
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
            setActionMessage((prev) => ({
                ...prev,
                verify:
                    err instanceof Error
                        ? err.message
                        : "Failed to verify flight",
            }));
        } finally {
            setActionLoading((prev) => ({ ...prev, verify: false }));
        }
    };

    const handleCancelFlight = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        if (!confirm("Are you sure you want to cancel this booking?")) {
            return;
        }

        setActionLoading((prev) => ({ ...prev, cancel: true }));
        setActionMessage((prev) => ({ ...prev, cancel: "" }));

        try {
            const res = await fetch(
                `/api/user/flight-bookings/${params.bookingId}`,
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

            setActionMessage((prev) => ({
                ...prev,
                cancel: data.message || "Flight cancelled successfully",
            }));

            // Refresh booking data
            const bookingRes = await fetch(
                `/api/user/flight-bookings/${params.bookingId}`,
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
            setActionMessage((prev) => ({
                ...prev,
                cancel:
                    err instanceof Error
                        ? err.message
                        : "Failed to cancel flight",
            }));
        } finally {
            setActionLoading((prev) => ({ ...prev, cancel: false }));
        }
    };

    if (loading) return <div className="max-w-4xl mx-auto p-8">Loading...</div>;
    if (error)
        return (
            <div className="max-w-4xl mx-auto p-8 text-red-600">{error}</div>
        );
    if (!booking)
        return <div className="max-w-4xl mx-auto p-8">Booking not found</div>;

    return (
        <div className="max-w-4xl mx-auto p-8 bg-white text-black shadow-md rounded">
            <div className="mb-6">
                <Link
                    href="/user/flight-bookings"
                    className="text-blue-600 hover:underline"
                >
                    &larr; Back to all bookings
                </Link>
            </div>

            <h1 className="text-3xl font-bold mb-6 text-gray-800">
                Flight Booking Details
            </h1>

            <div className="space-y-6">
                <div className="p-6 border border-gray-300 rounded bg-gray-50">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Booking Information
                            </h2>
                            <p className="text-gray-600">
                                Reference: {booking.afsBookingId}
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="border border-gray-200 p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 text-gray-800">
                                Departure
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <h4 className="text-sm font-medium text-gray-600">
                                        Outbound Flight
                                    </h4>
                                    <p className="mt-1">
                                        {formatDate(booking.departure.goDate)}
                                    </p>
                                    <p className="text-gray-600">
                                        {booking.departure.goAirport}
                                    </p>
                                </div>
                                {booking.departure.returnDate &&
                                    booking.departure.returnDate !== " " && (
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-600">
                                                Return Flight
                                            </h4>
                                            <p className="mt-1">
                                                {formatDate(
                                                    booking.departure.returnDate
                                                )}
                                            </p>
                                            <p className="text-gray-600">
                                                {
                                                    booking.departure
                                                        .returnAirport
                                                }
                                            </p>
                                        </div>
                                    )}
                            </div>
                        </div>

                        <div className="border border-gray-200 p-4 rounded">
                            <h3 className="font-medium text-lg mb-3 text-gray-800">
                                Arrival
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <h4 className="text-sm font-medium text-gray-600">
                                        Outbound Flight
                                    </h4>
                                    <p className="mt-1">
                                        {formatDate(booking.arrival.goDate)}
                                    </p>
                                    <p className="text-gray-600">
                                        {booking.arrival.goAirport}
                                    </p>
                                </div>
                                {booking.arrival.returnDate &&
                                    booking.arrival.returnDate !== " " && (
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-600">
                                                Return Flight
                                            </h4>
                                            <p className="mt-1">
                                                {formatDate(
                                                    booking.arrival.returnDate
                                                )}
                                            </p>
                                            <p className="text-gray-600">
                                                {booking.arrival.returnAirport}
                                            </p>
                                        </div>
                                    )}
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-200">
                        <div className="flex flex-wrap gap-4 mb-4">
                            <button
                                onClick={handleVerifyFlight}
                                disabled={
                                    actionLoading.verify ||
                                    booking.status === "CANCELLED"
                                }
                                className={`px-4 py-2 rounded-md ${
                                    actionLoading.verify
                                        ? "bg-blue-300"
                                        : "bg-blue-600 hover:bg-blue-700"
                                } text-white disabled:bg-gray-300 disabled:cursor-not-allowed`}
                            >
                                {actionLoading.verify
                                    ? "Verifying..."
                                    : "Verify Flight Status"}
                            </button>
                            <button
                                onClick={handleCancelFlight}
                                disabled={
                                    actionLoading.cancel ||
                                    booking.status === "CANCELLED"
                                }
                                className={`px-4 py-2 rounded-md ${
                                    actionLoading.cancel
                                        ? "bg-red-300"
                                        : "bg-red-600 hover:bg-red-700"
                                } text-white disabled:bg-gray-300 disabled:cursor-not-allowed`}
                            >
                                {actionLoading.cancel
                                    ? "Cancelling..."
                                    : "Cancel Booking"}
                            </button>
                        </div>
                        {actionMessage.verify && (
                            <p
                                className={`text-sm ${
                                    actionMessage.verify.includes("failed")
                                        ? "text-red-600"
                                        : "text-green-600"
                                }`}
                            >
                                {actionMessage.verify}
                            </p>
                        )}
                        {actionMessage.cancel && (
                            <p
                                className={`text-sm ${
                                    actionMessage.cancel.includes("failed")
                                        ? "text-red-600"
                                        : "text-green-600"
                                }`}
                            >
                                {actionMessage.cancel}
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
