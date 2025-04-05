"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

interface ItineraryDetail {
    id: number;
    totalPrice: number;
    status: string;
    bookingDate: string;
    flight?: {
        id: number;
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
        id: number;
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

export default function ItineraryDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const [itinerary, setItinerary] = useState<ItineraryDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [flightAction, setFlightAction] = useState({
        loading: false,
        message: "",
        type: "", // 'verify' or 'cancel'
    });
    const [hotelAction, setHotelAction] = useState({
        loading: false,
        message: "",
    });

    const [itineraryAction, setItineraryAction] = useState({
        loading: false,
        message: "",
    });

    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return;
        }

        const fetchItinerary = async () => {
            setLoading(true);
            setError("");
            try {
                const res = await fetch(
                    `/api/itineraries/${params.itineraryId}`,
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
                    setError(
                        data.error || "Failed to fetch itinerary details."
                    );
                } else {
                    const data = await res.json();
                    setItinerary(data);
                }
            } catch (err) {
                setError("An error occurred while fetching itinerary details.");
            } finally {
                setLoading(false);
            }
        };

        fetchItinerary();
    }, [params.itineraryId, router]);

    const formatDate = (dateString: string) => {
        if (!dateString) return "N/A";
        const date = new Date(dateString);
        return date.toLocaleDateString();
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case "DRAFT":
                return "text-yellow-600";
            case "CONFIRMED":
                return "text-green-600";
            case "CANCELLED":
                return "text-red-600";
            case "PENDING":
                return "text-yellow-600";
            default:
                return "text-gray-600";
        }
    };

    const handleVerifyFlight = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) return;

        setFlightAction({
            loading: true,
            message: "",
            type: "verify",
        });

        try {
            const res = await fetch(
                `/api/itineraries/${params.itineraryId}/flights`,
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

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Verification failed");
            }

            setFlightAction({
                loading: false,
                message: data.message || "Flight verified successfully",
                type: "verify",
            });

            // Refresh itinerary data
            const itineraryRes = await fetch(
                `/api/itineraries/${params.itineraryId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            if (itineraryRes.ok) {
                const itineraryData = await itineraryRes.json();
                setItinerary(itineraryData);
            }
        } catch (err) {
            setFlightAction({
                loading: false,
                message:
                    err instanceof Error
                        ? err.message
                        : "Failed to verify flight",
                type: "verify",
            });
        }
    };

    const handleCancelFlight = async () => {
        if (!confirm("Are you sure you want to cancel this flight?")) return;

        const token = localStorage.getItem("accessToken");
        if (!token) return;

        setFlightAction({
            loading: true,
            message: "",
            type: "cancel",
        });

        try {
            const res = await fetch(
                `/api/itineraries/${params.itineraryId}/flights`,
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

            setFlightAction({
                loading: false,
                message: data.message || "Flight cancelled successfully",
                type: "cancel",
            });

            // Refresh itinerary data
            const itineraryRes = await fetch(
                `/api/itineraries/${params.itineraryId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            if (itineraryRes.ok) {
                const itineraryData = await itineraryRes.json();
                setItinerary(itineraryData);
            }
        } catch (err) {
            setFlightAction({
                loading: false,
                message:
                    err instanceof Error
                        ? err.message
                        : "Failed to cancel flight",
                type: "cancel",
            });
        }
    };

    const handleCancelHotel = async () => {
        if (!confirm("Are you sure you want to cancel this hotel booking?"))
            return;

        const token = localStorage.getItem("accessToken");
        if (!token) return;

        setHotelAction({
            loading: true,
            message: "",
        });

        try {
            const res = await fetch(
                `/api/itineraries/${params.itineraryId}/hotels`,
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

            setHotelAction({
                loading: false,
                message: data.message || "Hotel booking cancelled successfully",
            });

            // Refresh itinerary data
            const itineraryRes = await fetch(
                `/api/itineraries/${params.itineraryId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            if (itineraryRes.ok) {
                const itineraryData = await itineraryRes.json();
                setItinerary(itineraryData);
            }
        } catch (err) {
            setHotelAction({
                loading: false,
                message:
                    err instanceof Error
                        ? err.message
                        : "Failed to cancel hotel booking",
            });
        }
    };

    const handleCancelItinerary = async () => {
        if (!confirm("Are you sure you want to cancel this entire itinerary?"))
            return;

        const token = localStorage.getItem("accessToken");
        if (!token) return;

        setItineraryAction({
            loading: true,
            message: "",
        });

        try {
            const res = await fetch(`/api/itineraries/${params.itineraryId}`, {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            if (res.status === 401) {
                localStorage.removeItem("accessToken");
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Cancellation failed");
            }

            setItineraryAction({
                loading: false,
                message: data.message || "Itinerary cancelled successfully",
            });

            // Refresh itinerary data
            const itineraryRes = await fetch(
                `/api/itineraries/${params.itineraryId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            if (itineraryRes.ok) {
                const itineraryData = await itineraryRes.json();
                setItinerary(itineraryData);
            }
        } catch (err) {
            setItineraryAction({
                loading: false,
                message:
                    err instanceof Error
                        ? err.message
                        : "Failed to cancel itinerary",
            });
        }
    };

    if (loading) return <div className="max-w-4xl mx-auto p-8">Loading...</div>;
    if (error)
        return (
            <div className="max-w-4xl mx-auto p-8 text-red-600">{error}</div>
        );
    if (!itinerary)
        return <div className="max-w-4xl mx-auto p-8">Itinerary not found</div>;

    return (
        <div className="max-w-4xl mx-auto p-8 bg-white text-black shadow-md rounded">
            <div className="mb-6">
                <Link
                    href="/itineraries"
                    className="text-blue-600 hover:underline"
                >
                    &larr; Back to all itineraries
                </Link>
            </div>

            <div className="flex justify-between items-center mb-5">
                <h1 className="text-3xl font-bold mb-6 text-gray-800">
                    Itinerary Details
                </h1>
                {itinerary.status !== "CONFIRMED" && (
                    <Link
                        href={`/checkout?itineraryId=${itinerary.id}`}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
                    >
                        Proceed to Checkout
                    </Link>
                )}
            </div>

            <div className="space-y-6">
                <div className="p-6 border border-gray-300 rounded bg-gray-50">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Itinerary #{itinerary.id}
                            </h2>
                        </div>

                        <div className="text-right">
                            <p
                                className={`text-lg font-semibold ${getStatusColor(
                                    itinerary.status
                                )}`}
                            >
                                {itinerary.status}
                            </p>
                            <p className="text-2xl font-bold">
                                ${itinerary.totalPrice.toFixed(2)}
                            </p>
                        </div>
                    </div>

                    {/* Flight Reservation Section */}
                    {itinerary.flight && (
                        <div className="mb-6 p-4 border border-gray-200 rounded p-3 bg-blue-50">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold text-gray-800">
                                    Flight Reservation
                                </h3>
                                <Link
                                    href={`/user/flight-bookings/${itinerary.flight.id}`}
                                    className="text-sm text-blue-600 hover:underline"
                                >
                                    View Flight Details
                                </Link>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h4 className="font-medium text-gray-700 mb-2">
                                        Departure
                                    </h4>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Date:
                                        </span>{" "}
                                        {formatDate(
                                            itinerary.flight.departure.goDate
                                        )}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            From:
                                        </span>{" "}
                                        {itinerary.flight.departure.goAirport}
                                    </p>
                                    {itinerary.flight.departure.returnDate && (
                                        <>
                                            <p className="text-gray-600">
                                                <span className="font-medium">
                                                    Return:
                                                </span>{" "}
                                                {formatDate(
                                                    itinerary.flight.departure
                                                        .returnDate
                                                )}
                                            </p>
                                            <p className="text-gray-600">
                                                <span className="font-medium">
                                                    To:
                                                </span>{" "}
                                                {
                                                    itinerary.flight.departure
                                                        .returnAirport
                                                }
                                            </p>
                                        </>
                                    )}
                                </div>
                                <div>
                                    <h4 className="font-medium text-gray-700 mb-2">
                                        Arrival
                                    </h4>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Date:
                                        </span>{" "}
                                        {formatDate(
                                            itinerary.flight.arrival.goDate
                                        )}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">To:</span>{" "}
                                        {itinerary.flight.arrival.goAirport}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 flex justify-between items-center">
                                <div>
                                    <p className="text-gray-700">
                                        <span className="font-medium">
                                            Status:
                                        </span>{" "}
                                        <span
                                            className={getStatusColor(
                                                itinerary.flight.status
                                            )}
                                        >
                                            {itinerary.flight.status}
                                        </span>
                                    </p>
                                    <p className="text-gray-700">
                                        <span className="font-medium">
                                            Price:
                                        </span>{" "}
                                        ${itinerary.flight.price.toFixed(2)}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleVerifyFlight}
                                        disabled={
                                            flightAction.loading ||
                                            itinerary.flight.status ===
                                                "CANCELLED"
                                        }
                                        className={`px-3 py-1 text-sm rounded ${
                                            flightAction.loading &&
                                            flightAction.type === "verify"
                                                ? "bg-blue-300"
                                                : "bg-blue-600 hover:bg-blue-700"
                                        } text-white disabled:bg-gray-300 disabled:cursor-not-allowed`}
                                    >
                                        {flightAction.loading &&
                                        flightAction.type === "verify"
                                            ? "Verifying..."
                                            : "Verify flight status"}
                                    </button>
                                    <button
                                        onClick={handleCancelFlight}
                                        disabled={
                                            flightAction.loading ||
                                            itinerary.flight.status ===
                                                "CANCELLED"
                                        }
                                        className={`px-3 py-1 text-sm rounded ${
                                            flightAction.loading &&
                                            flightAction.type === "cancel"
                                                ? "bg-red-300"
                                                : "bg-red-600 hover:bg-red-700"
                                        } text-white disabled:bg-gray-300 disabled:cursor-not-allowed`}
                                    >
                                        {flightAction.loading &&
                                        flightAction.type === "cancel"
                                            ? "Cancelling..."
                                            : "Cancel"}
                                    </button>
                                </div>
                            </div>
                            {flightAction.message && (
                                <p
                                    className={`mt-2 text-sm ${
                                        flightAction.message.includes("failed")
                                            ? "text-red-600"
                                            : "text-green-600"
                                    }`}
                                >
                                    {flightAction.message}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Hotel Reservation Section */}
                    {itinerary.hotel && (
                        <div className="p-4 border border-gray-200 rounded p-3 bg-green-50">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold text-gray-800">
                                    Hotel Reservation
                                </h3>
                                <Link
                                    href={`/user/hotel-bookings/${itinerary.hotel.id}`}
                                    className="text-sm text-blue-600 hover:underline"
                                >
                                    View Hotel Details
                                </Link>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h4 className="font-medium text-gray-700 mb-2">
                                        Hotel Information
                                    </h4>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Name:
                                        </span>{" "}
                                        {itinerary.hotel.hotel.name}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Address:
                                        </span>{" "}
                                        {itinerary.hotel.hotel.address}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Location:
                                        </span>{" "}
                                        {itinerary.hotel.hotel.location}
                                    </p>
                                </div>
                                <div>
                                    <h4 className="font-medium text-gray-700 mb-2">
                                        Stay Details
                                    </h4>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Room Type:
                                        </span>{" "}
                                        {itinerary.hotel.roomType.name}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Check-in:
                                        </span>{" "}
                                        {formatDate(itinerary.hotel.checkIn)}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">
                                            Check-out:
                                        </span>{" "}
                                        {formatDate(itinerary.hotel.checkOut)}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 flex justify-between items-center">
                                <div>
                                    <p className="text-gray-700">
                                        <span className="font-medium">
                                            Status:
                                        </span>{" "}
                                        <span
                                            className={getStatusColor(
                                                itinerary.hotel.status
                                            )}
                                        >
                                            {itinerary.hotel.status}
                                        </span>
                                    </p>
                                    <p className="text-gray-700">
                                        <span className="font-medium">
                                            Price:
                                        </span>{" "}
                                        ${itinerary.hotel.price.toFixed(2)}
                                    </p>
                                </div>
                                <button
                                    onClick={handleCancelHotel}
                                    disabled={
                                        hotelAction.loading ||
                                        itinerary.hotel.status === "CANCELLED"
                                    }
                                    className={`px-3 py-1 text-sm rounded ${
                                        hotelAction.loading
                                            ? "bg-red-300"
                                            : "bg-red-600 hover:bg-red-700"
                                    } text-white disabled:bg-gray-300 disabled:cursor-not-allowed`}
                                >
                                    {hotelAction.loading
                                        ? "Cancelling..."
                                        : "Cancel"}
                                </button>
                            </div>
                            {hotelAction.message && (
                                <p
                                    className={`mt-2 text-sm ${
                                        hotelAction.message.includes("failed")
                                            ? "text-red-600"
                                            : "text-green-600"
                                    }`}
                                >
                                    {hotelAction.message}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="mt-6 pt-4 border-t border-gray-200">
                        <p className="text-sm text-gray-500">
                            Booking created: {formatDate(itinerary.bookingDate)}
                        </p>
                    </div>

                    <div className="flex justify-end mb-4 gap-4">
                        <button
                            onClick={handleCancelItinerary}
                            disabled={
                                itineraryAction.loading ||
                                itinerary.status === "CANCELLED"
                            }
                            className={`px-4 py-2 rounded ${
                                itineraryAction.loading
                                    ? "bg-red-300"
                                    : "bg-red-600 hover:bg-red-700"
                            } text-white disabled:bg-gray-300 disabled:cursor-not-allowed`}
                        >
                            {itineraryAction.loading
                                ? "Cancelling Itinerary..."
                                : "Cancel Entire Itinerary"}
                        </button>
                    </div>
                    {itineraryAction.message && (
                        <p
                            className={`mt-2 text-sm ${
                                itineraryAction.message.includes("failed")
                                    ? "text-red-600"
                                    : "text-green-600"
                            }`}
                        >
                            {itineraryAction.message}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
