"use client";

import BookingStatusBadge from "@/app/components/BookingStatusBadge";

import { loginUrl } from "@/app/lib/return-path";

import { formatStayDate } from "@/app/lib/booking-display";

import { getAccessToken, sessionFetch } from "@/app/lib/session";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import { reservationRoutes } from "@/lib/flight-route-display";
import { useFeedback } from "@/app/context/FeedbackContext";

/** The flights of a booked direction, as the reservation stores them. */
interface StoredFlight {
    from: string | null;
    to: string | null;
    departDate: string | null;
    arriveDate: string | null;
}

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
        id: number;
        /*
         * Nullable in the API payload: both relations are `onDelete: SetNull`, so
         * deleting a hotel or room type leaves this reservation with a null
         * relation. Declaring them non-null here made the page throw a TypeError
         * and unmount the whole route (there is no `app/error.tsx`), so an
         * itinerary whose hotel was removed from the catalogue rendered as a
         * blank error page instead of its itinerary.
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

export default function ItineraryDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const { confirm, success, error: toastError, info } = useFeedback();
    const [itinerary, setItinerary] = useState<ItineraryDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    /*
     * One busy flag per action, used only to label and disable its own button.
     * Outcomes are reported as toasts, so there is no message state to paint the
     * wrong colour: a shared string plus a `verifyOk`/`cancelOk` pair would let a
     * failed cancellation leave an earlier successful verification looking like
     * the cancellation result.
     */
    const [flightBusy, setFlightBusy] = useState<"verify" | "cancel" | null>(null);
    const [hotelBusy, setHotelBusy] = useState(false);
    const [itineraryBusy, setItineraryBusy] = useState(false);

    useEffect(() => {
        const token = getAccessToken();
        if (!token) {
            router.push(loginUrl());
            return;
        }

        const fetchItinerary = async () => {
            setLoading(true);
            setError("");
            try {
                const res = await sessionFetch(
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
                    clearAccessToken();
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
        return date.toLocaleDateString("en-US");
    };

    /* Re-read the itinerary so the page reflects what the server holds. */
    const reloadItinerary = async (token: string) => {
        const itineraryRes = await sessionFetch(
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
    };

    const handleVerifyFlight = async () => {
        const token = getAccessToken();
        if (!token) return;

        setFlightBusy("verify");
        const pending = info("Checking flight status…", { duration: 0 });

        try {
            const res = await sessionFetch(
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
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Verification failed");
            }

            success("Flight status verified", {
                description: data.message || "The airline confirmed this flight.",
            });

            await reloadItinerary(token);
        } catch (err) {
            toastError("Verification failed", {
                description:
                    err instanceof Error ? err.message : "Failed to verify flight",
            });
        } finally {
            pending.dismiss();
            setFlightBusy(null);
        }
    };

    /**
     * Cancel the itinerary's flight, after a full-screen confirmation.
     *
     * The dialog names the consequences a generic "are you sure?" leaves
     * implicit: a cancellation is irreversible, the airline releases the seat, and
     * the itinerary total drops. "Cancel" on a card is one click away from a
     * mistake, which is exactly why it has to ask.
     */
    const handleCancelFlight = async () => {
        const confirmed = await confirm({
            title: "Cancel this flight?",
            description:
                "The demo flight reservation on this itinerary will be cancelled. This cannot be undone.",
            points: [
                "The ticket is released and the seat is no longer held.",
                "This itinerary's total is reduced by the flight's price.",
                "A new reservation uses the fare available at that time. No money is charged in this demo.",
            ],
            confirmLabel: "Yes, cancel flight",
            cancelLabel: "Keep my flight",
        });
        if (!confirmed) return;

        const token = getAccessToken();
        if (!token) return;

        setFlightBusy("cancel");
        const pending = info("Cancelling the flight…", { duration: 0 });

        try {
            const res = await sessionFetch(
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
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Cancellation failed");
            }

            success("Flight cancelled", {
                description: data.message || "The flight has been cancelled.",
            });

            await reloadItinerary(token);
        } catch (err) {
            toastError("Cancellation failed", {
                description:
                    err instanceof Error ? err.message : "Failed to cancel flight",
            });
        } finally {
            pending.dismiss();
            setFlightBusy(null);
        }
    };

    /**
     * Cancel the itinerary's hotel stay, after a full-screen confirmation.
     *
     * The room nights go back on sale as part of the same operation, so the copy
     * says so: a traveller deciding whether to cancel wants to know the stay is
     * actually released, not just flagged.
     */
    const handleCancelHotel = async () => {
        const confirmed = await confirm({
            title: "Cancel this hotel booking?",
            description:
                "The stay on this itinerary will be cancelled and the room released. This cannot be undone.",
            points: [
                "The nights are returned to the hotel's availability and can be sold to somebody else.",
                "This itinerary's total is reduced by the stay's price.",
                "The room can only be re-booked if it is still free.",
            ],
            confirmLabel: "Yes, cancel stay",
            cancelLabel: "Keep my stay",
        });
        if (!confirmed) return;

        const token = getAccessToken();
        if (!token) return;

        setHotelBusy(true);
        const pending = info("Cancelling the hotel booking…", { duration: 0 });

        try {
            const res = await sessionFetch(
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
                    data.message || "The stay has been cancelled and released.",
            });

            await reloadItinerary(token);
        } catch (err) {
            toastError("Cancellation failed", {
                description:
                    err instanceof Error
                        ? err.message
                        : "Failed to cancel hotel booking",
            });
        } finally {
            pending.dismiss();
            setHotelBusy(false);
        }
    };

    /**
     * Cancel everything on the itinerary, after a full-screen confirmation.
     *
     * This is the page's most destructive action — it cancels the flight and
     * the stay — so the dialog spells out both halves rather than asking a
     * generic "are you sure?".
     */
    const handleCancelItinerary = async () => {
        const hasFlight = itinerary?.flight != null;
        const hasHotel = itinerary?.hotel != null;
        const parts: string[] = [];
        if (hasFlight) parts.push("the flight");
        if (hasHotel) parts.push("the hotel booking");
        const subject =
            parts.length === 2
                ? "the flight and the hotel booking on this itinerary"
                : parts.length === 1
                  ? `${parts[0]} on this itinerary`
                  : "this itinerary";

        const confirmed = await confirm({
            title: "Cancel this entire itinerary?",
            description: `Cancelling will release ${subject}. This cannot be undone.`,
            points: [
                "Every reservation on the itinerary is cancelled with its provider.",
                "This is a demo cancellation. No real payment or refund takes place.",
                "The itinerary is marked CANCELLED and cannot be checked out.",
            ],
            confirmLabel: "Yes, cancel everything",
            cancelLabel: "Keep my itinerary",
        });
        if (!confirmed) return;

        const token = getAccessToken();
        if (!token) return;

        setItineraryBusy(true);
        const pending = info("Cancelling the itinerary…", { duration: 0 });

        try {
            const res = await sessionFetch(`/api/itineraries/${params.itineraryId}`, {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            if (res.status === 401) {
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Cancellation failed");
            }

            success("Itinerary cancelled", {
                description:
                    data.message ||
                    "Every reservation on this itinerary has been cancelled.",
            });

            await reloadItinerary(token);
        } catch (err) {
            toastError("Cancellation failed", {
                description:
                    err instanceof Error
                        ? err.message
                        : "Failed to cancel itinerary",
            });
        } finally {
            pending.dismiss();
            setItineraryBusy(false);
        }
    };

    if (loading) return <div className="page-shell">Loading...</div>;
    if (error)
        return (
            <div className="page-shell text-red-600 dark:text-red-400">
                {error}
            </div>
        );
    if (!itinerary)
        return <div className="page-shell">Itinerary not found</div>;

    return (
        <div className="page-shell records-page">
            <div className="mb-6">
                <Link
                    href="/itineraries"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                    &larr; Back to all itineraries
                </Link>
            </div>

            <div className="records-title-row mb-5">
                <h1 className="text-3xl font-bold heading">
                    Itinerary Details
                </h1>
                {/*
                  * DRAFT only. `/api/checkout` refuses a cancelled itinerary with
                  * `409 "This itinerary has been cancelled and cannot be checked
                  * out"`, so offering the link for `status !== "CONFIRMED"` gave a
                  * cancelled itinerary a button that could only ever fail.
                  */}
                {itinerary.status === "DRAFT" && (
                    <Link
                        href={`/checkout?itineraryId=${itinerary.id}`}
                        className="button-primary"
                    >
                        Review & confirm demo
                    </Link>
                )}
                {itinerary.status === "CONFIRMED" && (
                    <Link className="button-primary" href={`/checkout?itineraryId=${itinerary.id}`}>
                        View confirmation &amp; demo receipt
                    </Link>
                )}
            </div>

            <div className="space-y-6">
                <div className="record-panel">
                    <div className="record-heading">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Itinerary #{itinerary.id}
                            </h2>
                        </div>

                        <div className="text-right">
                            <BookingStatusBadge status={itinerary.status} />
                            <p className="text-2xl font-bold">
                                ${itinerary.totalPrice.toFixed(2)}
                            </p>
                        </div>
                    </div>

                    {/* Flight Reservation Section */}
                    {itinerary.flight && (
                        <div className="reservation-block trip-flight mb-6">
                            <div className="flex flex-wrap gap-4 justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold heading">
                                    Flight Reservation
                                </h3>
                                <Link
                                    href={`/user/flight-bookings/${itinerary.flight.id}`}
                                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    View Flight Details
                                </Link>
                            </div>

                            {reservationRoutes(itinerary.flight.departure, itinerary.flight.arrival).map(route => (
                                <section key={route.label} className="mb-4">
                                    <h4 className="font-semibold mb-2">{route.label}</h4>
                                    <div className="reservation-facts">
                                        <div><p><span>Departure</span></p><p className="font-semibold">{route.from}</p><p>{formatDate(route.departDate ?? "")}</p></div>
                                        <div><p><span>Arrival</span></p><p className="font-semibold">{route.to}</p><p>{formatDate(route.arriveDate ?? "")}</p></div>
                                    </div>
                                    {route.stops.length > 0 && <p className="mt-2 text-sm"><strong>Via</strong> {route.stops.join(" → ")}</p>}
                                </section>
                            ))}

                            <div className="reservation-actions flex flex-wrap gap-4 justify-between items-center">
                                <div>
                                    <p className="text-gray-700 dark:text-zinc-200">
                                        <span className="font-medium">
                                            Status:
                                        </span>{" "}
                                        <BookingStatusBadge status={itinerary.flight.status} />
                                    </p>
                                    <p className="text-gray-700 dark:text-zinc-200">
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
                                            flightBusy !== null ||
                                            itinerary.flight.status ===
                                                "CANCELLED"
                                        }
                                        className={`px-3 py-1 text-sm rounded ${
                                            flightBusy === "verify"
                                                ? "bg-blue-300 dark:bg-blue-900"
                                                : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                                        } text-white disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400`}
                                    >
                                        {flightBusy === "verify"
                                            ? "Verifying..."
                                            : "Verify flight status"}
                                    </button>
                                    <button
                                        onClick={handleCancelFlight}
                                        disabled={
                                            flightBusy !== null ||
                                            itinerary.flight.status ===
                                                "CANCELLED"
                                        }
                                        className={`px-3 py-1 text-sm rounded ${
                                            flightBusy === "cancel"
                                                ? "bg-red-300 dark:bg-red-900"
                                                : "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
                                        } text-white disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400`}
                                    >
                                        {flightBusy === "cancel"
                                            ? "Cancelling..."
                                            : "Cancel"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Hotel Reservation Section */}
                    {itinerary.hotel && (
                        <div className="reservation-block trip-hotel">
                            <div className="flex flex-wrap gap-4 justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold heading">
                                    Hotel Reservation
                                </h3>
                                <Link
                                    href={`/user/hotel-bookings/${itinerary.hotel.id}`}
                                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    View Hotel Details
                                </Link>
                            </div>

                            <div className="reservation-facts">
                                <div>
                                    <h4>
                                        Hotel Information
                                    </h4>
                                    <p>
                                        <span>
                                            Name:
                                        </span>{" "}
                                        {itinerary.hotel.hotel?.name ??
                                            "Hotel no longer available"}
                                    </p>
                                    <p>
                                        <span>
                                            Address:
                                        </span>{" "}
                                        {itinerary.hotel.hotel?.address ?? "N/A"}
                                    </p>
                                    <p>
                                        <span>
                                            Location:
                                        </span>{" "}
                                        {itinerary.hotel.hotel?.location ?? "N/A"}
                                    </p>
                                </div>
                                <div>
                                    <h4>
                                        Stay Details
                                    </h4>
                                    <p>
                                        <span>
                                            Room Type:
                                        </span>{" "}
                                        {itinerary.hotel.roomType?.name ??
                                            "Room type no longer available"}
                                    </p>
                                    <p>
                                        <span>
                                            Check-in:
                                        </span>{" "}
                                        {formatStayDate(itinerary.hotel.checkIn)}
                                    </p>
                                    <p>
                                        <span>
                                            Check-out:
                                        </span>{" "}
                                        {formatStayDate(itinerary.hotel.checkOut)}
                                    </p>
                                </div>
                            </div>

                            <div className="reservation-actions flex flex-wrap gap-4 justify-between items-center">
                                <div>
                                    <p className="text-gray-700 dark:text-zinc-200">
                                        <span className="font-medium">
                                            Status:
                                        </span>{" "}
                                        <BookingStatusBadge status={itinerary.hotel.status} />
                                    </p>
                                    <p className="text-gray-700 dark:text-zinc-200">
                                        <span className="font-medium">
                                            Price:
                                        </span>{" "}
                                        ${itinerary.hotel.price.toFixed(2)}
                                    </p>
                                </div>
                                <button
                                    onClick={handleCancelHotel}
                                    disabled={
                                        hotelBusy ||
                                        itinerary.hotel.status === "CANCELLED"
                                    }
                                    className={`px-3 py-1 text-sm rounded ${
                                        hotelBusy
                                            ? "bg-red-300 dark:bg-red-900"
                                            : "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
                                    } text-white disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400`}
                                >
                                    {hotelBusy ? "Cancelling..." : "Cancel"}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="mt-6 pt-4 border-t border-gray-200 dark:border-white/10">
                        <p className="text-sm text-gray-500 dark:text-zinc-400">
                            Booking created: {formatDate(itinerary.bookingDate)}
                        </p>
                    </div>

                    <div className="flex justify-end mb-4 gap-4">
                        <button
                            onClick={handleCancelItinerary}
                            disabled={
                                itineraryBusy ||
                                itinerary.status === "CANCELLED"
                            }
                            className={`px-4 py-2 rounded ${
                                itineraryBusy
                                    ? "bg-red-300 dark:bg-red-900"
                                    : "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
                            } text-white disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400`}
                        >
                            {itineraryBusy
                                ? "Cancelling Itinerary..."
                                : "Cancel Entire Itinerary"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
