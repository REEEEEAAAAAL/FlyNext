"use client";

import BookingStatusBadge from "@/app/components/BookingStatusBadge";

import { loginUrl } from "@/app/lib/return-path";

import EmptyState from "@/app/components/EmptyState";

import { formatStayDate } from "@/app/lib/booking-display";

import { getAccessToken, sessionFetch } from "@/app/lib/session";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import { reservationRoutes } from "@/lib/flight-route-display";

/** The flights of a booked direction, as the reservation stores them. */
interface StoredFlight {
    from: string | null;
    to: string | null;
    departDate: string | null;
    arriveDate: string | null;
}

interface Itinerary {
    id: number;
    totalPrice: number;
    status: string;
    bookingDate: string;
    flight?: {
        departure: {
            goDate: string;
            returnDate?: string;
            goAirport: string;
            returnAirport?: string;
            goLegs?: StoredFlight[];
            returnLegs?: StoredFlight[];
        };
        arrival: {
            goDate: string;
            returnDate?: string;
            goAirport: string;
            returnAirport?: string;
            goLegs?: StoredFlight[];
            returnLegs?: StoredFlight[];
        };
        price: number;
        status: string;
    };
    hotel?: {
        /*
         * Both relations are nullable in the API payload: `HotelReservation.hotel`
         * and `.roomType` are `onDelete: SetNull`, so deleting a hotel or a room
         * type leaves the reservation in place with a null relation. Declaring
         * them non-null here is what makes this page throw — and because the
         * dereference happens inside the `.map()` below, one such itinerary would
         * take the whole list down and the user could reach none of their others.
         */
        hotel: {
            name: string;
            address: string;
            location: string;
        } | null;
        roomType: {
            name: string;
        } | null;
        checkIn: string;
        checkOut: string;
        price: number;
        status: string;
    };
}

export default function ItineraryListPage() {
    const router = useRouter();
    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const token = getAccessToken();
        if (!token) {
            router.push(loginUrl());
            return;
        }

        const fetchData = async () => {
            const response = await sessionFetch("/api/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.status === 401) {
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }
        };

        const fetchItineraries = async () => {
            setLoading(true);
            setError("");
            try {
                const res = await sessionFetch("/api/itineraries", {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: token ? `Bearer ${token}` : "",
                    },
                });

                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || "Failed to fetch itineraries.");
                } else {
                    const data = await res.json();
                    setItineraries(data.itineraries || []);
                }
            } catch (err) {
                setError("An error occurred while fetching itineraries.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        fetchItineraries();
    }, [router]);

    const formatDate = (dateString: string) => {
        if (!dateString) return "N/A";
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US");
    };

    return (
        <div className="page-shell records-page">
            <header className="mb-6">
                <div className="records-title-row">
                    <h1 className="text-3xl font-bold heading">Your trips, in one place</h1>
                    {itineraries.length > 0 && (
                        <Link className="button-primary" href="/itineraries/new">Build an itinerary</Link>
                    )}
                </div>
                <p className="muted text-sm mt-3">Review reservations, confirm your demo booking, or manage a change of plans.</p>
            </header>
            {loading && <p role="status" className="muted">Loading itineraries...</p>}
            {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
            {itineraries.length > 0 ? (
                <div className="space-y-4">
                    {itineraries.map((itinerary, index) => (
                        <div
                            key={itinerary.id}
                            className="record-panel"
                        >
                            <div className="booking-card-header flex flex-wrap gap-4 justify-between items-start">
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">
                                        Itinerary #{itinerary.id}
                                    </h2>
                                    <p className="muted mb-1">
                                        <span className="font-medium">
                                            Status:
                                        </span>{" "}
                                        <BookingStatusBadge status={itinerary.status} />
                                    </p>
                                    <p className="muted mb-1">
                                        <span className="font-medium">
                                            Total Price:
                                        </span>{" "}
                                        ${itinerary.totalPrice.toFixed(2)}
                                    </p>
                                    <p className="muted mb-1">
                                        <span className="font-medium">
                                            Booked on:
                                        </span>{" "}
                                        {formatDate(itinerary.bookingDate)}
                                    </p>
                                </div>
                                <Link
                                    href={`/itineraries/${itinerary.id}`}
                                    className="button-secondary"
                                >
                                    View Details
                                </Link>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {itinerary.flight && (
                                    <section className="trip-segment trip-flight">
                                        <h3>
                                            Flight
                                        </h3>
                                        {reservationRoutes(itinerary.flight.departure, itinerary.flight.arrival).map(route => (
                                            <div key={route.label} className="mb-2 last:mb-0">
                                                <p className="font-semibold">{route.label} · {route.from} → {route.to}</p>
                                                {route.stops.length > 0 && <p>Via {route.stops.join(" → ")}</p>}
                                                <p className="muted">{formatDate(route.departDate ?? "")}</p>
                                            </div>
                                        ))}
                                    </section>
                                )}

                                {itinerary.hotel && (
                                    <section className="trip-segment trip-hotel">
                                        <h3>
                                            Hotel
                                        </h3>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            <span className="font-medium">
                                                Hotel:
                                            </span>{" "}
                                            {itinerary.hotel.hotel?.name ??
                                                "Hotel no longer available"}
                                        </p>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            <span className="font-medium">
                                                Check-in:
                                            </span>{" "}
                                            {formatStayDate(itinerary.hotel.checkIn)}
                                        </p>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            <span className="font-medium">
                                                Check-out:
                                            </span>{" "}
                                            {formatStayDate(itinerary.hotel.checkOut)}
                                        </p>
                                    </section>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                !loading && !error && (
                    <div className="trip-empty"><EmptyState title="Your next trip starts here" description="Reserve a flight or stay, then bring your bookings together in one itinerary." href="/itineraries/new" action="Build an itinerary" /></div>
                )
            )}
        </div>
    );
}
