"use client";

import BookingStatusBadge from "@/app/components/BookingStatusBadge";

import { loginUrl } from "@/app/lib/return-path";

import EmptyState from "@/app/components/EmptyState";

import { getAccessToken, sessionFetch } from "@/app/lib/session";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import { formatStayDate, formatLegDate, hotelReference, stayNights } from "@/app/lib/booking-display";
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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    /**
     * Validate the session before the page shows anything.
     *
     * A stored token is not necessarily a usable one, and the booking list
     * endpoints answer `401` rather than redirecting. Probing `/api/user` first
     * means an expired session starts the refresh flow immediately instead of
     * leaving the traveller on a page whose only content is "Unauthorized".
     */
    const refreshToken = useCallback(async () => {
        const token = getAccessToken();
        if (!token) {
            router.push(loginUrl());
            return;
        }
        const response = await sessionFetch("/api/user", {
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
    }, [router]);

    useEffect(() => {
        const token = getAccessToken();
        if (!token) {
            router.push(loginUrl());
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
                const res = await sessionFetch(
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
    }, [router, refreshToken, showError]);

    return (
        <div className="page-shell records-page">
            <h1 className="text-3xl font-bold mb-6 heading">
                Your Hotel Bookings
            </h1>
            {loading && (
                <p className="muted">Loading hotel bookings...</p>
            )}
            {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
            {bookings.length > 0 ? (
                <div className="space-y-4">
                    {bookings.map((booking) => {
                        const nights = stayNights(booking.checkIn, booking.checkOut);

                        return (
                            <div
                                key={booking.id}
                                className="record-panel"
                            >
                                <div className="booking-card-header flex flex-wrap gap-4 justify-between items-start">
                                    <div>
                                        <h2 className="heading text-xl font-semibold">{booking.hotelName}</h2>
                                        <p className="muted text-sm mt-1">Booking #{booking.reference}</p>
                                    </div>
                                    <BookingStatusBadge status={booking.status} />
                                </div>
                                <p className="my-4">{[booking.roomTypeName, booking.hotelLocation].filter(Boolean).join(" · ")}</p>
                                <dl className="stay-dates">
                                    <div><dt>Check-in</dt><dd>{formatStayDate(booking.checkIn)}</dd></div>
                                    <div><dt>Check-out</dt><dd>{formatStayDate(booking.checkOut)}</dd></div>
                                </dl>
                                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                    <p>
                                        <strong className="heading text-lg">${booking.price.toFixed(2)}</strong>{" "}
                                        <span className="text-sm muted">
                                            USD{nights !== null && ` for ${nights} ${nights === 1 ? "night" : "nights"}`}
                                        </span>
                                    </p>
                                    <Link href={`/user/hotel-bookings/${booking.id}`} className="button-secondary">View Details</Link>
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
                    <EmptyState title="Find somewhere to settle in" description="Your hotel reservations will appear here, with stay dates and cancellation options." href="/hotels" action="Find a stay" />
                )
            )}
        </div>
    );
}
