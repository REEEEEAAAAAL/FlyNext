"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

/** Status pill colours, shared by this page's chips. */
function statusChipClass(status: string): string {
    if (status === "CONFIRMED") {
        return "bg-green-100 text-green-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-1 dark:ring-emerald-500/30";
    }
    if (status === "PENDING") {
        return "bg-yellow-100 text-yellow-800 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-1 dark:ring-amber-500/30";
    }
    return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300 dark:ring-1 dark:ring-red-500/30";
}

/**
 * One direction of travel.
 *
 * The card is keyed on the direction rather than on the column it was read from,
 * so the outbound card always shows where the trip started and where it landed,
 * and a return card does the same for the way home. A one-way booking renders
 * exactly one of these — there is no empty "Return" placeholder, because the
 * caller only ever maps over the directions that exist.
 *
 * A direction flown in more than one leg shows where it changes planes: without
 * the "Via" line a connecting ticket reads as a non-stop one, which is how
 * `YYZ→HKG→CAN` came to be displayed as "From YYZ To CAN" and nothing else.
 */
function DirectionCard({
    direction,
    tone,
}: {
    direction: FlightDirection;
    tone: "outbound" | "return";
}) {
    const palette =
        tone === "outbound"
            ? "bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/20"
            : "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20";
    const title =
        tone === "outbound"
            ? "text-blue-800 dark:text-blue-300"
            : "text-emerald-800 dark:text-emerald-300";

    return (
        <div className={`rounded-lg border p-4 ${palette}`}>
            <h3 className={`mb-3 font-semibold ${title}`}>
                {tone === "outbound" ? "Outbound" : "Return"}
            </h3>
            <dl className="space-y-2 text-sm text-gray-700 dark:text-zinc-200">
                <div className="flex gap-2">
                    <dt className="w-14 shrink-0 font-medium muted">From</dt>
                    <dd className="font-semibold">{direction.from}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="w-14 shrink-0 font-medium muted">Departs</dt>
                    <dd>{formatLegDate(direction.departDate)}</dd>
                </div>
                {direction.stops.length > 0 && (
                    <div className="flex gap-2">
                        <dt className="w-14 shrink-0 font-medium muted">Via</dt>
                        <dd className="font-semibold">
                            {direction.stops.join(" → ")}
                        </dd>
                    </div>
                )}
                <div className="flex gap-2">
                    <dt className="w-14 shrink-0 font-medium muted">To</dt>
                    <dd className="font-semibold">{direction.to}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="w-14 shrink-0 font-medium muted">Arrives</dt>
                    <dd>{formatLegDate(direction.arriveDate)}</dd>
                </div>
            </dl>
        </div>
    );
}

export default function UserFlightBookingsPage() {
    const router = useRouter();
    const { error: showError } = useFeedback();
    const [bookings, setBookings] = useState<FlightBooking[]>([]);
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
        // Protect the page: if no access token is found, redirect to login.
        const token = localStorage.getItem("accessToken");
        if (!token) {
            // Redirect to login if no token found.
            router.push("/auth/login");
            return;
        }

        refreshToken();

        const fetchBookings = async () => {
            setLoading(true);
            setError("");
            try {
                /*
                 * `includeCancelled=1`: this is the traveller's own history, so a
                 * booking they cancelled belongs on it — the same request the hotel
                 * booking history makes. Without the flag the endpoint answers with
                 * the live bookings only, which is what the itinerary builder
                 * needs, and a cancelled flight would be missing from this page
                 * from the moment it was cancelled. Cancelled stays are listed the
                 * same way.
                 */
                const res = await fetch(
                    "/api/user/flight-bookings?includeCancelled=1",
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
                    const failure = data.error || "Failed to fetch flight bookings.";
                    setError(failure);
                    /*
                     * The inline paragraph stays as the page's own state, and the
                     * toast makes the failure noticeable even if the user has
                     * already scrolled past that slot.
                     */
                    showError("Could not load your flight bookings", {
                        description: failure,
                    });
                } else {
                    const data = await res.json();
                    setBookings(data.bookings || []);
                }
            } catch (err) {
                const failure = "An error occurred while fetching flight bookings.";
                setError(failure);
                showError("Could not load your flight bookings", {
                    description: failure,
                });
            } finally {
                setLoading(false);
            }
        };

        fetchBookings();
    }, [router, showError]);

    return (
        <div className="card max-w-6xl mx-auto p-8 text-black dark:text-zinc-100">
            <h1 className="text-3xl font-bold mb-6 heading">
                Your Flight Bookings
            </h1>
            {loading && (
                <p className="muted">Loading flight bookings...</p>
            )}
            {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
            {bookings.length > 0 ? (
                <div className="space-y-4">
                    {bookings.map((booking) => {
                        /*
                         * One-way trips yield a single direction; round trips
                         * yield two. Nothing below hard-codes a return card, so a
                         * one-way booking cannot render an empty second panel.
                         */
                        const directions = flightDirections(
                            booking.departure,
                            booking.arrival
                        );

                        return (
                            <div
                                key={booking.id}
                                className="p-6 border border-gray-300 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        {/*
                                         * The heading is the short, readable booking
                                         * reference. The full id is a 36-character
                                         * UUID and belongs on the detail page,
                                         * where it is useful for support.
                                         */}
                                        <h2 className="text-xl font-semibold mb-2">
                                            Booking #
                                            {bookingReference(booking.afsBookingId)}
                                        </h2>
                                        <p className="muted mb-1">
                                            <span className="font-medium">
                                                Status:
                                            </span>{" "}
                                            <span
                                                className={`px-2 py-1 rounded text-xs ${statusChipClass(
                                                    booking.status
                                                )}`}
                                            >
                                                {booking.status}
                                            </span>
                                        </p>
                                        <p className="muted mb-1">
                                            <span className="font-medium">
                                                Price:
                                            </span>{" "}
                                            ${booking.price.toFixed(2)}
                                        </p>
                                        <p className="muted mb-1">
                                            <span className="font-medium">
                                                Booked on:
                                            </span>{" "}
                                            {formatLegDate(booking.createdAt)}
                                        </p>
                                    </div>
                                    <Link
                                        href={`/user/flight-bookings/${booking.id}`}
                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
                                    >
                                        View Details
                                    </Link>
                                </div>

                                <div
                                    className={`mt-4 grid grid-cols-1 gap-4 ${
                                        directions.length > 1 ? "md:grid-cols-2" : ""
                                    }`}
                                >
                                    {directions.map((direction) => (
                                        <DirectionCard
                                            key={direction.kind}
                                            direction={direction}
                                            tone={direction.kind}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /*
                 * `!error` as well: a failed fetch leaves `bookings` empty, so
                 * without it the page would state "No flight bookings found."
                 * underneath the red error explaining that the list could not be
                 * loaded at all.
                 */
                !loading && !error && (
                    <p className="muted">No flight bookings found.</p>
                )
            )}
        </div>
    );
}
