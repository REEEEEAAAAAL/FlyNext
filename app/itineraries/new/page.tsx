"use client";

import { reservationRoutes } from "@/lib/flight-route-display";

import { loginUrl } from "@/app/lib/return-path";

import BookingSteps from "@/app/components/BookingSteps";
import Link from "next/link";

import { bookingRequest } from "@/app/lib/booking-request";
import { getAccessToken, sessionFetch } from "@/app/lib/session";

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FlightBookingListItem, HotelBookingListItem } from "@/types";
import { clearAccessToken } from "@/app/lib/session";
import {
	bookingReference,
	hotelReference,
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
  return Number.isNaN(parsed.getTime()) ? "N/A" : parsed.toLocaleDateString("en-US");
}

interface ReservationOption {
  id: number;
  reference: string;
  price: number;
  description: ReactNode;
}

/** Dates and transfers stay with their direction, including for legacy bookings. */
function flightOption(booking: FlightBookingListItem): ReservationOption {
  return {
    id: booking.id,
    reference: bookingReference(booking.afsBookingId),
    price: booking.price,
    description: reservationRoutes(booking.departure, booking.arrival).map(direction => (
      <span className="reservation-option-detail" key={direction.label}>
        <span className="reservation-option-meta">{direction.label} · {formatDay(direction.departDate)}</span>
        {" "}{direction.from} → {direction.to}
        {direction.stops.length > 0 && (
          <span className="muted"> via {direction.stops.join(" → ")}</span>
        )}
      </span>
    )),
  };
}

function hotelOption(booking: HotelBookingListItem): ReservationOption {
  const nights = stayNights(booking.period?.checkIn, booking.period?.checkOut);
  const duration = nights === null ? "" : ` · ${nights} ${nights === 1 ? "night" : "nights"}`;
  return {
    id: booking.id,
    reference: hotelReference(booking.id),
    price: booking.totalPrice,
    description: (
      <span className="reservation-option-detail">
        {booking.hotel.name}
        {booking.roomType?.name && <span className="muted"> · {booking.roomType.name}</span>}
        <span className="reservation-option-meta">
          {" "}{formatStayDate(booking.period?.checkIn)} → {formatStayDate(booking.period?.checkOut)}{duration}
        </span>
      </span>
    ),
  };
}

function ReservationOptionContent({ option }: { option: ReservationOption }) {
  return (
    <span className="reservation-option-content">
      <span className="reservation-option-header">
        <span>#{option.reference}</span>{" "}
        <span className="reservation-option-price">${option.price.toFixed(2)}</span>
      </span>
      {option.description}
    </span>
  );
}

/**
 * An inline disclosure keeps long options within the form across browsers.
 * Native radios preserve arrow-key selection and allow clearing either reservation.
 */
function ReservationPicker({ kind, options, selectedId, onSelect }: {
  kind: "flight" | "hotel";
  options: ReservationOption[];
  selectedId: number | "";
  onSelect: (id: number | "") => void;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const selected = options.find(option => option.id === selectedId);

  function confirmSelection(id: number | "") {
    onSelect(id);
    if (picker.current) picker.current.open = false;
    trigger.current?.focus();
  }

  return (
    <details ref={picker} className="reservation-picker" name="itinerary-reservations">
      <summary ref={trigger} className="field reservation-picker-trigger">
        {selected ? (
          <ReservationOptionContent option={selected} />
        ) : (
          <span className="muted">Select a {kind} booking</span>
        )}
      </summary>
      <fieldset className="reservation-picker-options">
        <legend className="sr-only">Select a {kind} booking</legend>
        {[null, ...options].map(option => {
          const id = option?.id ?? "";
          return (
            <label className="reservation-option" key={id}>
              <input
                type="radio"
                name={`${kind}ReservationId`}
                value={id}
                checked={selectedId === id}
                onChange={() => onSelect(id)}
                onClick={event => {
                  // Arrow keys also generate a radio click. Keep the list open during navigation.
                  if (event.detail > 0) confirmSelection(id);
                }}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    confirmSelection(id);
                  }
                }}
              />
              {option ? <ReservationOptionContent option={option} /> : <span>No {kind} booking</span>}
            </label>
          );
        })}
      </fieldset>
    </details>
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
      router.push(loginUrl());
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
      router.push(loginUrl());
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
    <div className="page-shell page-shell--form card text-[var(--text)]">
      <BookingSteps current="plan" />
      <h1 className="text-3xl font-bold mb-6 heading">Bring your trip together</h1>
      <p className="search-intro">Choose one flight reservation, one hotel reservation, or both. You can review the total before confirming with DEMO payment.</p>
      {loading && <p role="status" className="muted">Loading bookings...</p>}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      
      <div className="plan-choice">
        <h2 className="text-xl font-semibold heading">
          Select Flight Reservation
        </h2>
        {flightBookings.length > 0 ? (
          <ReservationPicker
            kind="flight"
            options={flightBookings.map(flightOption)}
            selectedId={selectedFlightId}
            onSelect={setSelectedFlightId}
          />
        ) : (
          !loading && (
            <p className="muted">No unlinked flight bookings available. <Link className="text-blue-600 dark:text-blue-300 underline" href="/flights">Find a flight</Link></p>
          )
        )}
      </div>
      <div className="plan-choice">
        <h2 className="text-xl font-semibold heading">
          Select Hotel Reservation
        </h2>
        {hotelBookings.length > 0 ? (
          <ReservationPicker
            kind="hotel"
            options={hotelBookings.map(hotelOption)}
            selectedId={selectedHotelId}
            onSelect={setSelectedHotelId}
          />
        ) : (
          !loading && (
            <p className="muted">No unlinked hotel bookings available. <Link className="text-blue-600 dark:text-blue-300 underline" href="/hotels">Find a stay</Link></p>
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
        disabled={loading || submitting || (selectedFlightId === "" && selectedHotelId === "")}
        className="button-primary"
      >
        {submitting ? "Creating..." : "Create Itinerary"}
      </button>
    </div>
  );
}
