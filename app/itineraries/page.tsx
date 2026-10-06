"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import { transferAirports } from "@/app/lib/booking-display";

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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        const fetchData = async () => {
            const response = await fetch("/api/user", {
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
                const res = await fetch("/api/itineraries", {
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
        return date.toLocaleDateString();
    };

    /*
     * Status chips keep their light-mode fill and switch to a translucent fill
     * + soft text + hairline ring on dark, so a chip reads as a chip instead of
     * a bright pale block sitting on the zinc-900 panel.
     */
    const getStatusColor = (status: string) => {
        switch (status) {
            case "CONFIRMED":
                return "bg-green-100 text-green-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-1 dark:ring-emerald-500/30";
            case "CANCELLED":
                return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300 dark:ring-1 dark:ring-red-500/30";
            case "DRAFT":
                return "bg-yellow-100 text-yellow-800 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-1 dark:ring-amber-500/30";
            default:
                return "bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-zinc-300 dark:ring-1 dark:ring-white/15";
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-8 card text-black dark:text-zinc-100">
            <h1 className="text-3xl font-bold mb-6 heading">
                Your Itineraries
            </h1>
            {loading && <p className="muted">Loading itineraries...</p>}
            {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
            {itineraries.length > 0 ? (
                <div className="space-y-4">
                    {itineraries.map((itinerary, index) => (
                        <div
                            key={itinerary.id}
                            className="p-6 border border-gray-300 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                        >
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">
                                        Itinerary #{itinerary.id}
                                    </h2>
                                    <p className="muted mb-1">
                                        <span className="font-medium">
                                            Status:
                                        </span>{" "}
                                        <span
                                            className={`px-2 py-1 rounded text-xs ${getStatusColor(
                                                itinerary.status
                                            )}`}
                                        >
                                            {itinerary.status}
                                        </span>
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
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors dark:bg-blue-600 dark:hover:bg-blue-500"
                                >
                                    View Details
                                </Link>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {itinerary.flight && (
                                    <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded">
                                        <h3 className="font-medium text-blue-800 dark:text-blue-300 mb-2">
                                            Flight
                                        </h3>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            <span className="font-medium">
                                                Departure:
                                            </span>{" "}
                                            {formatDate(
                                                itinerary.flight.departure
                                                    .goDate
                                            )}
                                        </p>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            <span className="font-medium">
                                                From:
                                            </span>{" "}
                                            {
                                                itinerary.flight.departure
                                                    .goAirport
                                            }
                                        </p>
                                        {/*
                                          The airport the journey changes planes
                                          at, when it changes at one: a connecting
                                          ticket otherwise reads as non-stop.
                                        */}
                                        {transferAirports(
                                            itinerary.flight.departure.goLegs
                                        ).length > 0 && (
                                            <p className="text-gray-700 dark:text-zinc-200">
                                                <span className="font-medium">
                                                    Via:
                                                </span>{" "}
                                                {transferAirports(
                                                    itinerary.flight.departure
                                                        .goLegs
                                                ).join(" → ")}
                                            </p>
                                        )}
                                        {/*
                                          The API marks an absent leg with a
                                          single space, which `new Date()` cannot
                                          parse, so the sentinel is tested for
                                          explicitly rather than by truthiness.
                                        */}
                                        {itinerary.flight.departure.returnDate !=
                                            null &&
                                            itinerary.flight.departure
                                                .returnDate !== " " && (
                                            <>
                                                <p className="text-gray-700 dark:text-zinc-200">
                                                    <span className="font-medium">
                                                        Return:
                                                    </span>{" "}
                                                    {formatDate(
                                                        itinerary.flight.departure
                                                            .returnDate
                                                    )}
                                                </p>
                                                {transferAirports(
                                                    itinerary.flight.departure
                                                        .returnLegs
                                                ).length > 0 && (
                                                    <p className="text-gray-700 dark:text-zinc-200">
                                                        <span className="font-medium">
                                                            Return via:
                                                        </span>{" "}
                                                        {transferAirports(
                                                            itinerary.flight
                                                                .departure
                                                                .returnLegs
                                                        ).join(" → ")}
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}

                                {itinerary.hotel && (
                                    <div className="p-3 bg-green-50 dark:bg-emerald-500/10 rounded">
                                        <h3 className="font-medium text-green-800 dark:text-emerald-300 mb-2">
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
                                            {formatDate(
                                                itinerary.hotel.checkIn
                                            )}
                                        </p>
                                        <p className="text-gray-700 dark:text-zinc-200">
                                            <span className="font-medium">
                                                Check-out:
                                            </span>{" "}
                                            {formatDate(
                                                itinerary.hotel.checkOut
                                            )}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                !loading && (
                    <p className="muted">No itineraries found.</p>
                )
            )}
        </div>
    );
}
