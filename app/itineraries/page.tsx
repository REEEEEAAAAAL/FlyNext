"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
        };
        arrival: {
            goDate: string;
            returnDate?: string;
            goAirport: string;
            returnAirport?: string;
        };
        price: number;
        status: string;
    };
    hotel?: {
        hotel: {
            name: string;
            address: string;
            location: string;
        };
        roomType: {
            name: string;
        };
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
                localStorage.removeItem("accessToken");
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

    const getStatusColor = (status: string) => {
        switch (status) {
            case "CONFIRMED":
                return "bg-green-100 text-green-800";
            case "CANCELLED":
                return "bg-red-100 text-red-800";
            case "DRAFT":
                return "bg-yellow-100 text-yellow-800";
            default:
                return "bg-gray-100 text-gray-800";
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-8 bg-white text-black shadow-md rounded">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">
                Your Itineraries
            </h1>
            {loading && <p className="text-gray-600">Loading itineraries...</p>}
            {error && <p className="text-red-600">{error}</p>}
            {itineraries.length > 0 ? (
                <div className="space-y-4">
                    {itineraries.map((itinerary, index) => (
                        <div
                            key={itinerary.id}
                            className="p-6 border border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">
                                        Itinerary #{itinerary.id}
                                    </h2>
                                    <p className="text-gray-600 mb-1">
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
                                    <p className="text-gray-600 mb-1">
                                        <span className="font-medium">
                                            Total Price:
                                        </span>{" "}
                                        ${itinerary.totalPrice.toFixed(2)}
                                    </p>
                                    <p className="text-gray-600 mb-1">
                                        <span className="font-medium">
                                            Booked on:
                                        </span>{" "}
                                        {formatDate(itinerary.bookingDate)}
                                    </p>
                                </div>
                                <Link
                                    href={`/itineraries/${itinerary.id}`}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                >
                                    View Details
                                </Link>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {itinerary.flight && (
                                    <div className="p-3 bg-blue-50 rounded">
                                        <h3 className="font-medium text-blue-800 mb-2">
                                            Flight
                                        </h3>
                                        <p className="text-gray-700">
                                            <span className="font-medium">
                                                Departure:
                                            </span>{" "}
                                            {formatDate(
                                                itinerary.flight.departure
                                                    .goDate
                                            )}
                                        </p>
                                        <p className="text-gray-700">
                                            <span className="font-medium">
                                                From:
                                            </span>{" "}
                                            {
                                                itinerary.flight.departure
                                                    .goAirport
                                            }
                                        </p>
                                        {itinerary.flight.departure
                                            .returnDate && (
                                            <p className="text-gray-700">
                                                <span className="font-medium">
                                                    Return:
                                                </span>{" "}
                                                {formatDate(
                                                    itinerary.flight.departure
                                                        .returnDate
                                                )}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {itinerary.hotel && (
                                    <div className="p-3 bg-green-50 rounded">
                                        <h3 className="font-medium text-green-800 mb-2">
                                            Hotel
                                        </h3>
                                        <p className="text-gray-700">
                                            <span className="font-medium">
                                                Hotel:
                                            </span>{" "}
                                            {itinerary.hotel.hotel.name}
                                        </p>
                                        <p className="text-gray-700">
                                            <span className="font-medium">
                                                Check-in:
                                            </span>{" "}
                                            {formatDate(
                                                itinerary.hotel.checkIn
                                            )}
                                        </p>
                                        <p className="text-gray-700">
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
                    <p className="text-gray-600">No itineraries found.</p>
                )
            )}
        </div>
    );
}
