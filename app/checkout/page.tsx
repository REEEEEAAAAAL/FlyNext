"use client";
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
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState("");
  /*
   * The invoice download needs its own two states, separate from the `loading`
   * and `error` the order summary is gated on: sharing them would let a click on
   * "Download Invoice PDF" replace the whole summary with "Loading order
   * summary...", and a download that failed would set `error` and so delete the
   * order summary and the payment form from the page.
   */
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  // Check if user is authenticated by fetching user info
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) {
        router.push("/auth/login");
        return;
      }
      const response = await fetch("/api/user", {
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
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/login");
      return;
    }

    const fetchItinerary = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/itineraries/${itineraryId}`, {
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
          setOrder(data);
        }
      } catch (err) {
        const failure = "An error occurred while fetching itinerary details.";
        setError(failure);
        toastError("Could not load your order", { description: failure });
      } finally {
        setLoading(false);
      }
    };

    fetchItinerary();
  }, [itineraryId, router, toastError]);

  const handlePaymentSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!itineraryId) {
      const failure = "Missing itinerary identifier.";
      setError(failure);
      toastError("Payment not submitted", { description: failure });
      return;
    }
    setError("");
    setSubmitting(true);
    const pending = info("Processing your payment…", { duration: 0 });

    try {
      const token = localStorage.getItem("accessToken");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // `/api/checkout` reads `itineraryId` with `readString` before parsing it
        // as a positive integer, so it must be sent as a JSON string.
        body: JSON.stringify({
          itineraryId: String(itineraryId),
          cardNumber,
          cardExpiry,
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
        const failure = data.error || "Payment failed.";
        setError(failure);
        toastError("Payment failed", { description: failure });
      } else {
        success("Payment confirmed", {
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
      const failure = "An error occurred while processing payment.";
      setError(failure);
      toastError("Payment failed", { description: failure });
    } finally {
      pending.dismiss();
      setSubmitting(false);
    }
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setDownloadError("");
      const token = localStorage.getItem("accessToken");

      if (!token || !itineraryId) {
        router.push("/auth/login");
        return;
      }

      const response = await fetch(`/api/invoice?itineraryId=${itineraryId}`, {
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
    <div className="max-w-3xl mx-auto p-8 card text-[var(--text)]">
      <h1 className="text-3xl font-bold mb-6 heading">Checkout</h1>

      {loading ? (
        <p className="muted">Loading order summary...</p>
      ) : error ? (
        <p className="text-red-600 dark:text-red-400">{error}</p>
      ) : order ? (
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 heading">
            Order Summary (Itinerary #{order.id})
          </h2>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Total Price:</strong> ${order.totalPrice.toFixed(2)}
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Booking Date:</strong>{" "}
            {new Date(order.bookingDate).toLocaleString()}
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Status:</strong> {order.status}
          </p>
          {/* Aggregate summary only: the itinerary total, booking date and status. */}
        </div>
      ) : (
        <p className="muted"> Hi there! Please create your itinerary first :) </p>
      )}

      <form onSubmit={handlePaymentSubmit}>
        <div className="mb-4">
          <label htmlFor="cardNumber" className="label mb-1">
            Card Number:
          </label>
          <input
            type="text"
            id="cardNumber"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            required
            placeholder="Enter card number"
            className="field"
          />
        </div>
        <div className="mb-6">
          <label htmlFor="cardExpiry" className="label mb-1">
            Card Expiry:
          </label>
          <input
            type="text"
            id="cardExpiry"
            value={cardExpiry}
            onChange={(e) => setCardExpiry(e.target.value)}
            required
            placeholder="MM/YY"
            className="field"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {submitting ? "Processing Payment..." : "Submit Payment"}
        </button>
      </form>

      {invoiceUrl && (
        <div className="mt-4">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? "Preparing Invoice..." : "Download Invoice PDF"}
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