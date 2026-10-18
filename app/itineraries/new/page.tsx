"use client";

import { bookingRequest } from "@/app/lib/booking-request";
import { getAccessToken, sessionFetch } from "@/app/lib/session";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { FlightBookingListItem, HotelBookingListItem } from "@/types";
import { clearAccessToken } from "@/app/lib/session";
import {
	bookingReference,
	hotelReference,
	hasLegValue,
	stayNights,
	formatStayDate,
} from "@/app/lib/booking-display";
import { useFeedback } from "@/app/context/FeedbackContext";

/**
 * A date from the booking payload, or a placeholder.
 *
 * The endpoints serialise `Date` columns to ISO strings over JSON, but the shared
 * types describe them as `Date` (they are the same values the handlers hold), so
 * both are accepted. The list endpoints also carry the `" "` sentinel for an
 * absent leg value, which a falsy check alone would not catch.
 */
function formatDay(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string" && value.trim().length === 0) return "N/A";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "N/A" : parsed.toLocaleDateString();
}

/**
 * Everything a traveller needs to recognise a flight in the dropdown.
 *
 * A `<select>` renders one line of text per option, so the label has to earn its
 * characters. It leads with the booking reference — the handle that appears on
 * the traveller's own booking page, in the confirmation email and on anything
 * they would read out to support — then the route, then the dates. The outbound
 * date alone is not enough to tell two bookings apart for the same route, so the
 * return date is included whenever the trip has one, and the price is a further
 * tie-breaker between two bookings of the same itinerary.
 */
function flightLabel(booking: FlightBookingListItem): string {
  const from = booking.departure?.goAirport ?? "";
  const to = booking.arrival?.goAirport ?? "";
  const route =
    hasLegValue(from) && hasLegValue(to) ? `${from} → ${to}` : "Route unavailable";
  const outbound = `out ${formatDay(booking.departure?.goDate)}`;
  const inbound = hasLegValue(booking.departure?.returnDate)
    ? `, back ${formatDay(booking.departure?.returnDate)}`
    : ", one-way";
  return (
    `#${bookingReference(booking.afsBookingId)} — ${route} — ` +
    `${outbound}${inbound} — $${booking.price.toFixed(2)}`
  );
}

/**
 * The same, for a stay: which hotel and room, the nights, and the price.
 *
 * The reference leads here too. Two stays at the same hotel are otherwise
 * indistinguishable, and "which of these two identical rows is the one I just
 * booked" is the question this list exists to answer.
 */
function hotelLabel(booking: HotelBookingListItem): string {
  const room = booking.roomType?.name ? `, ${booking.roomType.name}` : "";
  const nights = stayNights(booking.period?.checkIn, booking.period?.checkOut);
  const duration = nights === null ? "" : ` (${nights} ${nights === 1 ? "night" : "nights"})`;
  return (
    `#${hotelReference(booking.id)} — ${booking.hotel.name}${room}, ` +
    `${formatStayDate(booking.period?.checkIn)} → ${formatStayDate(booking.period?.checkOut)}` +
    `${duration} — $${booking.totalPrice.toFixed(2)}`
  );
}

/**
 * Is this reservation still available to attach to a new itinerary?
 *
 * Both halves of the question are required:
 *
 * - `status !== "CANCELLED"` — a cancelled reservation can never be linked, and
 *   `POST /api/itineraries` answers `409` for it. This is checked again here even
 *   though both list endpoints already exclude cancelled rows, because this page
 *   is the one place where offering a dead reservation is a bug rather than a
 *   cosmetic problem, and it must not depend on a query parameter that a caller
 *   could drop.
 * - `!itineraryId` — one reservation can back at most one itinerary (the column
 *   is unique in the schema), so an already-linked booking would fail with `409`
 *   as well.
 */
function isSelectable(
  booking: { status: string; itineraryId: number | null }
): boolean {
  return booking.status !== "CANCELLED" && !booking.itineraryId;
}

/** Repeated submissions retain their original request key. */
interface Submission {
  payload: { message?: string; reservations: { id: number }; error?: string } | null;
  failure: string;
  status: number | null;
}
async function submitItinerary(token: string, body: Record<string, number | null>): Promise<Submission> {
  try {
    const response = await bookingRequest("/api/itineraries", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload) return { payload, failure: "", status: response.status };
    return { payload: null, status: response.status, failure: response.status >= 500 ? "The result is unknown. Retry with the same selections or check My Itineraries." : payload?.error || "The result is unknown. Check My Itineraries before submitting again." };
  } catch {
    return { payload: null, status: null, failure: "The result is unknown. Check My Itineraries before submitting again." };
  }
}

export default function CreateItineraryPage() {
  const router = useRouter();
  const { error: toastError, success } = useFeedback();
  const [flightBookings, setFlightBookings] = useState<FlightBookingListItem[]>([]);
  const [hotelBookings, setHotelBookings] = useState<HotelBookingListItem[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState<number | "">("");
  const [selectedHotelId, setSelectedHotelId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Fetch unlinked flight and hotel bookings for the logged-in user.
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.push("/auth/login");
      return;
    }
    const fetchBookings = async () => {
      setLoading(true);
      setError("");
      try {
        // Fetch flight bookings
        const resFlight = await sessionFetch("/api/user/flight-bookings", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        /*
         * The status has to be checked before the body is read. On a `401` the
         * envelope is `{ error: "Unauthorized" }`, so `.bookings || []` turned an
         * expired session into "No unlinked flight bookings available" and the
         * dead token was never cleared — the user only found out by pressing
         * "Create Itinerary".
         */
        if (resFlight.status === 401) {
          clearAccessToken();
          router.push("/auth/refresh");
          return;
        }
        if (!resFlight.ok) {
          const failure = await resFlight.json().catch(() => null);
          throw new Error(failure?.error || "Failed to fetch flight bookings.");
        }
        const dataFlight = await resFlight.json();
        /*
         * Only reservations that can actually be linked: neither already spoken
         * for by another itinerary nor cancelled. The endpoints already exclude
         * cancelled rows, and `isSelectable` re-checks it so this page cannot be
         * broken by a caller that forgets the query flag.
         */
        setFlightBookings(
          (dataFlight.bookings || []).filter((booking: FlightBookingListItem) =>
            isSelectable(booking)
          )
        );

        // Fetch hotel bookings
        const resHotel = await sessionFetch("/api/user/hotel-bookings", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        if (resHotel.status === 401) {
          clearAccessToken();
          router.push("/auth/refresh");
          return;
        }
        if (!resHotel.ok) {
          const failure = await resHotel.json().catch(() => null);
          throw new Error(failure?.error || "Failed to fetch hotel bookings.");
        }
        const dataHotel = await resHotel.json();
        setHotelBookings(
          (dataHotel.bookings || []).filter((booking: HotelBookingListItem) =>
            isSelectable(booking)
          )
        );
      } catch (err: any) {
        const failure = err.message || "Failed to fetch bookings.";
        setError(failure);
        toastError("Could not load your reservations", { description: failure });
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, [router, toastError]);

  // Handler to create itinerary.
  const handleCreateItinerary = async () => {
    if (selectedFlightId === "" && selectedHotelId === "") {
      setError("Please select at least one reservation (flight or hotel).");
      return;
    }
    // A second click while the first request is in flight would create a second
    // itinerary from the same reservations, which the API answers with a 409 only
    // after the user has paid for a round trip.
    if (submitting) {
      return;
    }
    const token = getAccessToken();
    if (!token) {
      router.push("/auth/login");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const { payload, failure, status } = await submitItinerary(token, {
        flightReservationId: selectedFlightId !== "" ? selectedFlightId : null,
        hotelReservationId: selectedHotelId !== "" ? selectedHotelId : null,
      });

      if (payload === null) {
        /*
         * An expired session is the one failure with a recovery path the page can
         * start itself, and the load effect already uses it — so the create button
         * has to reach the same refresh page instead of reporting "Unauthorized"
         * as if it were a server fault.
         */
        if (status === 401) {
          clearAccessToken();
          router.push("/auth/refresh");
          return;
        }
        setError(failure);
        toastError("Itinerary not created", { description: failure });
        return;
      }
      /*
       * The success toast is raised before the redirect: the itinerary page is a
       * different route, but the toast host lives in the root layout, so the
       * confirmation survives the navigation instead of being unmounted with the
       * page that raised it.
       */
      success(payload.message || "Itinerary created successfully.", {
        description: "Opening your itinerary…",
        duration: 3000,
      });
      // Redirect to itinerary details page.
      router.push(`/itineraries/${payload.reservations.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8 card text-[var(--text)]">
      <h1 className="text-3xl font-bold mb-6 heading">Create Itinerary</h1>
      {loading && <p className="muted">Loading bookings...</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      
      <div className="mb-4">
        <h2 className="text-xl font-semibold heading">
          Select Flight Reservation
        </h2>
        {flightBookings.length > 0 ? (
          <select
            aria-label="Select a Flight Booking"
            value={selectedFlightId}
            /*
             * `Number("")` is `0`, not `""`. Coercing unconditionally made the
             * placeholder store `0`, so the guard in `handleCreateItinerary` (which
             * tests `=== ""`) never fired and the request carried
             * `flightReservationId: 0` — rejected by the API with a raw
             * "must be a positive integer" instead of the intended prompt.
             */
            onChange={(e) =>
              setSelectedFlightId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="field"
          >
            <option value="">-- Select a Flight Booking --</option>
            {flightBookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {flightLabel(booking)}
              </option>
            ))}
          </select>
        ) : (
          !loading && (
            <p className="muted">No unlinked flight bookings available.</p>
          )
        )}
      </div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold heading">
          Select Hotel Reservation
        </h2>
        {hotelBookings.length > 0 ? (
          <select
            aria-label="Select a Hotel Booking"
            value={selectedHotelId}
            onChange={(e) =>
              setSelectedHotelId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="field"
          >
            <option value="">-- Select a Hotel Booking --</option>
            {hotelBookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {hotelLabel(booking)}
              </option>
            ))}
          </select>
        ) : (
          !loading && (
            <p className="muted">No unlinked hotel bookings available.</p>
          )
        )}
      </div>
      <button
        onClick={handleCreateItinerary}
        /*
         * Disabled, not merely guarded, while a request is in flight: the retry
         * delay makes the first attempt look finished for a moment, and a button
         * that still invites a click there is how one selection becomes two
         * itineraries.
         */
        disabled={submitting}
        className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-500"
      >
        {submitting ? "Creating..." : "Create Itinerary"}
      </button>
    </div>
  );
}
