"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import {
    bookingReference,
    flightDirections,
    formatLegDate,
    type FlightDirection,
    type FlightDirectionInput,
} from "@/app/lib/booking-display";
import { useFeedback } from "@/app/context/FeedbackContext";

interface FlightBooking {
    id: number;
    afsBookingId: string;
    status: string;
    price: number;
    departure: FlightDirectionInput;
    arrival: FlightDirectionInput;
    createdAt: string;
}

/**
 * One direction of travel, as a panel on the detail page.
 *
 * This page is where a traveller checks what they actually bought, so a
 * direction flown in several legs lists them: the summary names the ends of the
 * journey, and the breakdown below it names each flight and the airport it
 * changes planes at.
 */
function DirectionPanel({ direction }: { direction: FlightDirection }) {
    const isReturn = direction.kind === "return";
    const connections = direction.legs.length > 1;

    return (
        <div className="border divider p-4 rounded">
            <div className="mb-3 flex items-center gap-2">
                <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                        isReturn ? "bg-emerald-600" : "bg-blue-600"
                    }`}
                    aria-hidden="true"
                >
                    {isReturn ? "R" : "O"}
                </span>
                <h3 className="font-medium text-lg heading">
                    {isReturn ? "Return" : "Outbound"}
                </h3>
                {connections && (
                    <span className="muted text-sm">
                        {direction.legs.length} flights · {direction.stops.length}{" "}
                        {direction.stops.length === 1 ? "stop" : "stops"}
                    </span>
                )}
            </div>
            <dl className="space-y-3 text-sm">
                <div>
                    <dt className="font-medium muted">From</dt>
                    <dd className="mt-0.5 text-base font-semibold">
                        {direction.from}
                    </dd>
                </div>
                <div>
                    <dt className="font-medium muted">Departs</dt>
                    <dd className="mt-0.5">{formatLegDate(direction.departDate)}</dd>
                </div>
                {direction.stops.length > 0 && (
                    <div>
                        <dt className="font-medium muted">Via</dt>
                        <dd className="mt-0.5 font-semibold">
                            {direction.stops.join(" → ")}
                        </dd>
                    </div>
                )}
                <div>
                    <dt className="font-medium muted">To</dt>
                    <dd className="mt-0.5 text-base font-semibold">
                        {direction.to}
                    </dd>
                </div>
                <div>
                    <dt className="font-medium muted">Arrives</dt>
                    <dd className="mt-0.5">{formatLegDate(direction.arriveDate)}</dd>
                </div>
            </dl>

            {connections && (
                <div className="mt-4 border-t divider pt-3">
                    <p className="font-medium muted mb-2">Flights</p>
                    <ol className="space-y-2 text-sm">
                        {direction.legs.map((leg, index) => (
                            <li key={`${leg.from}-${leg.to}-${index}`}>
                                <p className="font-semibold text-gray-800 dark:text-zinc-100">
                                    {index + 1}. {leg.from} → {leg.to}
                                </p>
                                <p className="muted">
                                    Departs {formatLegDate(leg.departDate)} ·
                                    Arrives {formatLegDate(leg.arriveDate)}
                                </p>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
}

export default function FlightBookingDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const { confirm, error: showError, success, info } = useFeedback();
    const [booking, setBooking] = useState<FlightBooking | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [actionLoading, setActionLoading] = useState({
        verify: false,
        cancel: false,
    });
    /*
     * One flag per action, used only to drive the buttons' own busy styling.
     * The reported outcome goes to a toast, so a failed cancellation can no
     * longer repaint an earlier successful verification, and a message can no
     * longer be green just because its text happened to contain no "failed".
     */
    const [confirming, setConfirming] = useState(false);

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
        /*
         * A stored token is not necessarily a usable one, and this endpoint
         * answers `401` rather than redirecting. The probe starts the refresh
         * flow immediately instead of rendering "Booking not found" for a
         * booking that exists.
         */
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
                    clearAccessToken();
                    router.push("/auth/refresh");
                    return;
                }

                if (!res.ok) {
                    const data = await res.json();
                    const failure = data.error || "Failed to fetch booking details.";
                    setError(failure);
                    showError("Could not load this booking", {
                        description: failure,
                    });
                } else {
                    const data = await res.json();
                    setBooking(data.booking);
                }
            } catch (err) {
                const failure = "An error occurred while fetching booking details.";
                setError(failure);
                showError("Could not load this booking", { description: failure });
            } finally {
                setLoading(false);
            }
        };

        fetchBooking();
    }, [params.bookingId, router, showError]);

    const handleVerifyFlight = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        setActionLoading((prev) => ({ ...prev, verify: true }));
        const pending = info("Checking flight status…", { duration: 0 });

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
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Verification failed");
            }

            success("Flight status verified", {
                description: data.message || "The airline confirmed this booking.",
            });

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
            showError(
                err instanceof Error ? err.message : "Failed to verify flight"
            );
        } finally {
            pending.dismiss();
            setActionLoading((prev) => ({ ...prev, verify: false }));
        }
    };

    /**
     * Ask for confirmation, then cancel.
     *
     * The `window.confirm()` this replaces was the only guard on an irreversible
     * action and said nothing about what it would do. The dialog states the
     * consequence, names the booking being cancelled, and returns a promise so
     * the rest of the handler reads the same way it did before.
     */
    const handleCancelFlight = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        const reference =
            booking === null ? "" : bookingReference(booking.afsBookingId);

        const confirmed = await confirm({
            title: "Cancel this flight booking?",
            description: `Booking #${reference} will be cancelled with the airline. This cannot be undone.`,
            points: [
                "The ticket is released and the seat is no longer held.",
                "Any itinerary total that includes this flight is reduced by its price.",
                "To travel on these dates you would have to book again, at the price available then.",
            ],
            confirmLabel: "Yes, cancel booking",
            cancelLabel: "Keep my booking",
        });
        if (!confirmed) {
            return;
        }

        setActionLoading((prev) => ({ ...prev, cancel: true }));
        setConfirming(true);
        const pending = info("Cancelling your booking…", { duration: 0 });

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
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Cancellation failed");
            }

            success("Flight booking cancelled", {
                description:
                    data.message ||
                    `Booking #${reference} has been cancelled with the airline.`,
            });

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
            showError(
                err instanceof Error ? err.message : "Failed to cancel flight"
            );
        } finally {
            pending.dismiss();
            setConfirming(false);
            setActionLoading((prev) => ({ ...prev, cancel: false }));
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

    const directions = flightDirections(booking.departure, booking.arrival);
    const reference = bookingReference(booking.afsBookingId);

    return (
        <div className="card max-w-4xl mx-auto p-8 text-black dark:text-zinc-100">
            <div className="mb-6">
                <Link
                    href="/user/flight-bookings"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                >
                    &larr; Back to all bookings
                </Link>
            </div>

            <h1 className="text-3xl font-bold mb-6 heading">
                Flight Booking Details
            </h1>

            <div className="space-y-6">
                <div className="p-6 border border-gray-300 dark:border-white/10 rounded bg-gray-50 dark:bg-white/5">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Booking #{reference}
                            </h2>
                            {/*
                             * The full provider id stays on the page: it is what
                             * the airline and support look the booking up by, so
                             * the short reference above is not a replacement for
                             * it, only the readable form of it.
                             */}
                            <p className="muted text-sm break-all">
                                Full reference:{" "}
                                <span className="font-mono">
                                    {booking.afsBookingId}
                                </span>
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

                    {/*
                     * Outbound always, return only when there is one. A one-way
                     * booking therefore renders a single full-width panel rather
                     * than an empty half of a two-column grid.
                     */}
                    <div
                        className={`grid grid-cols-1 gap-6 ${
                            directions.length > 1 ? "md:grid-cols-2" : ""
                        }`}
                    >
                        {directions.map((direction) => (
                            <DirectionPanel key={direction.kind} direction={direction} />
                        ))}
                    </div>

                    <div className="mt-6 pt-4 border-t divider">
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
                                        : "bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500"
                                } text-white disabled:bg-gray-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed`}
                            >
                                {actionLoading.verify
                                    ? "Verifying..."
                                    : "Verify Flight Status"}
                            </button>
                            <button
                                onClick={handleCancelFlight}
                                disabled={
                                    actionLoading.cancel ||
                                    confirming ||
                                    booking.status === "CANCELLED"
                                }
                                className={`px-4 py-2 rounded-md ${
                                    actionLoading.cancel
                                        ? "bg-red-300"
                                        : "bg-red-600 hover:bg-red-700 dark:hover:bg-red-500"
                                } text-white disabled:bg-gray-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed`}
                            >
                                {actionLoading.cancel
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
