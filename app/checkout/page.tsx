"use client";

import { loginUrl } from "@/app/lib/return-path";

import { formatStayDate } from "@/app/lib/booking-display";
import BookingSteps from "@/app/components/BookingSteps";
import Link from "next/link";

import { bookingRequest } from "@/app/lib/booking-request";
import { getAccessToken, sessionFetch } from "@/app/lib/session";
export const dynamic = 'force-dynamic';

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { clearAccessToken } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

interface OrderSummary {
  id: number;
  totalPrice: number;
  status: string;
  bookingDate: string;
  flight?: any;
  hotel?: any;
}

function CheckoutPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itineraryId = searchParams.get("itineraryId");
  const { success, error: toastError, info } = useFeedback();

  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState("");
  /*
   * The invoice download needs its own two states, separate from the `loading`
   * and `error` the order summary is gated on: sharing them would let a click on
   * "Download demo receipt PDF" replace the whole summary with "Loading order
   * summary...", and a download that failed would set `error` and so delete the
   * order summary and the payment form from the page.
   */
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  // Check if user is authenticated by fetching user info
  useEffect(() => {
    const checkAuth = async () => {
      const token = getAccessToken();
      if (!token) {
        router.push(loginUrl());
        return;
      }
      const response = await sessionFetch("/api/user", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        clearAccessToken();
        router.push("/auth/refresh");
      }
    };
    checkAuth();
  }, [router]);

  // The order summary comes from the itineraries API; `/api/checkout` only
  // completes the purchase.
  useEffect(() => {
    if (!itineraryId) return;
    const token = getAccessToken();
    if (!token) {
      router.push(loginUrl());
      return;
    }

    const controller = new AbortController();
    setOrder(null); setInvoiceUrl("");
    const fetchItinerary = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await sessionFetch(`/api/itineraries/${itineraryId}`, {
          signal: controller.signal,
          method: "GET",
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

        if (!res.ok) {
          const data = await res.json();
          const failure = data.error || "Failed to fetch itinerary details.";
          setError(failure);
          toastError("Could not load your order", { description: failure });
        } else {
          const data = await res.json();
          if (controller.signal.aborted) return;
          setOrder(data);
          if (data.status === "CONFIRMED") setInvoiceUrl(`/api/invoice?itineraryId=${itineraryId}`);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const failure = "An error occurred while fetching itinerary details.";
        setError(failure);
        toastError("Could not load your order", { description: failure });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void fetchItinerary();
    return () => controller.abort();
  }, [itineraryId, router, toastError]);

  const handlePaymentSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || loading || !order || order.status !== "DRAFT") return;
    if (!itineraryId) {
      const failure = "Missing itinerary identifier.";
      setError(failure);
      toastError("Confirmation not submitted", { description: failure });
      return;
    }
    setError("");
    setSubmitting(true);
    const pending = info("Confirming your demo booking...", { duration: 0 });

    try {
      const token = getAccessToken();
      if (!token) {
        router.push(loginUrl());
        return;
      }

      const res = await bookingRequest("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itineraryId: String(itineraryId),
          paymentMethod: "DEMO",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          // An expired token is the one failure here that has a recovery path.
          clearAccessToken();
          router.push("/auth/refresh");
          return;
        }
        const failure = res.status >= 500 ? "The result is unknown. Retry with the same details or check My Itineraries." : data.error || "Demo confirmation failed.";
        setError(failure);
        toastError("Confirmation failed", { description: failure });
      } else {
        success("Demo booking confirmed", {
          description:
            data.message ||
            "Your booking is confirmed. An invoice is ready to download.",
        });
        /*
         * The server flips the itinerary to CONFIRMED and returns the updated row,
         * which was being discarded. The order summary then kept rendering the
         * pre-payment status ("DRAFT") directly under a message saying the booking
         * was confirmed, until a manual reload.
         */
        if (data.itinerary) {
          setOrder((current) =>
            current === null ? current : { ...current, ...data.itinerary }
          );
        }
        // After successful checkout, set an invoice URL (it will trigger a download or open a new tab)
        setInvoiceUrl(`/api/invoice?itineraryId=${itineraryId}`);
      }
    } catch (err) {
      const failure = "The result is unknown. Retry with the same details or check My Itineraries.";
      setError(failure);
      toastError("Confirmation failed", { description: failure });
    } finally {
      pending.dismiss();
      setSubmitting(false);
    }
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setDownloadError("");
      const token = getAccessToken();

      if (!token || !itineraryId) {
        router.push(loginUrl());
        return;
      }

      const response = await sessionFetch(`/api/invoice?itineraryId=${itineraryId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        // Same recovery path the payment and summary requests use: an expired
        // token is not a download failure.
        clearAccessToken();
        router.push("/auth/refresh");
        return;
      }

      if (!response.ok) {
        // The route answers with a JSON envelope on every failure, including the
        // rate-limit `429`, so surface its message rather than a status number.
        const detail = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          detail?.error ?? `Could not download the invoice (${response.status})`
        );
      }

      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/pdf")) {
        throw new Error("Received non-PDF response");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice_${itineraryId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // A failed download has to reach the user: logging it alone leaves no way
      // to tell a failure apart from a slow response. It is reported next to the
      // button rather than in the summary's error slot, which would blank the
      // order summary and the payment form along with it — and as a toast, so it
      // is noticed without scrolling back to the button.
      const failure =
        err instanceof Error ? err.message : "Could not download the invoice";
      setDownloadError(failure);
      toastError("Invoice download failed", { description: failure });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="page-shell page-shell--form card text-[var(--text)]">
      <BookingSteps current="confirm" />
      <h1 className="text-3xl font-bold mb-6 heading">Review your trip</h1>

      {loading ? (
        <p className="muted">Loading order summary...</p>
      ) : error && !order ? (
        <div role="alert"><p className="text-red-600 dark:text-red-400">{error}</p><button className="button-secondary mt-4" onClick={() => window.location.reload()}>Reload order</button><Link className="button-secondary mt-4 ml-2" href="/itineraries">My trips</Link></div>
      ) : order ? (
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 heading">
            Order Summary (Itinerary #{order.id})
          </h2>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>{order.status === "DRAFT" ? "Total to confirm:" : "Current trip total:"}</strong> ${order.totalPrice.toFixed(2)} USD
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Booking Date:</strong>{" "}
            {new Date(order.bookingDate).toLocaleString("en-US")}
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Status:</strong> {order.status}
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            {order.flight && <div className="surface p-4"><p className="eyebrow mb-2">FLIGHT</p><p className="font-semibold">{order.flight.departure?.goAirport} → {order.flight.arrival?.goAirport}</p><p className="text-sm muted">${order.flight.price?.toFixed(2)} USD · {order.flight.status}</p></div>}
            {order.hotel && <div className="surface p-4"><p className="eyebrow mb-2">STAY</p><p className="font-semibold">{order.hotel.hotel?.name ?? "Hotel reservation"}</p><p className="text-sm muted">{formatStayDate(order.hotel.checkIn)} – {formatStayDate(order.hotel.checkOut)}</p><p className="text-sm muted">${order.hotel.price?.toFixed(2)} USD · {order.hotel.status}</p></div>}
          </div>
          {order.status === "CONFIRMED" && <p className="text-xs muted mt-4">The demo receipt preserves the original confirmation amount. The current trip total reflects any later cancellations.</p>}
        </div>
      ) : (
        <div className="surface p-6"><p className="muted">Create an itinerary from your existing bookings to review and confirm your trip.</p><Link className="button-primary mt-4" href="/itineraries/new">Build an itinerary</Link></div>
      )}

      {error && order && <p role="alert" className="mb-4 text-red-600 dark:text-red-400">{error}</p>}
      {order?.status === "CONFIRMED" && <p role="status" className="surface p-4 mb-4 text-emerald-700 dark:text-emerald-300">Demo booking confirmed. No money was charged. Your receipt is ready.</p>}
      <form onSubmit={handlePaymentSubmit}>
        <p className="mb-6 muted">Demo checkout uses a simulated payment method. No money is charged. Do not provide card or passport details.</p>
        <button
          type="submit"
          disabled={loading || submitting || !order || order.status !== "DRAFT"}
          className="w-full py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {submitting ? "Confirming..." : order?.status === "CONFIRMED" ? "Demo booking confirmed" : order?.status === "CANCELLED" ? "Itinerary cancelled" : "Confirm Demo Booking"}
        </button>
      </form>

      {(invoiceUrl || order?.status === "CONFIRMED") && (
        <div className="mt-4">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? "Preparing receipt..." : "Download demo receipt PDF"}
          </button>
          {downloadError && (
            <p
              role="alert"
              className="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {downloadError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CheckoutPageContent />
    </Suspense>
  );
}