"use client";
export const dynamic = 'force-dynamic';

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

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

  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState("");

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
        localStorage.removeItem("accessToken");
        router.push("/auth/refresh");
      }
    };
    checkAuth();
  }, [router]);

  // Fetch order summary from the itineraries API instead of /api/checkout
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
          localStorage.removeItem("accessToken");
          router.push("/auth/refresh");
          return;
        }

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to fetch itinerary details.");
        } else {
          const data = await res.json();
          setOrder(data);
        }
      } catch (err) {
        setError("An error occurred while fetching itinerary details.");
      } finally {
        setLoading(false);
      }
    };

    fetchItinerary();
  }, [itineraryId, router]);

  const handlePaymentSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!itineraryId) {
      setError("Missing itinerary identifier.");
      return;
    }
    setError("");
    setMessage("");
    setSubmitting(true);

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
        body: JSON.stringify({
          itineraryId: Number(itineraryId),
          cardNumber,
          cardExpiry,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Payment failed.");
      } else {
        setMessage(data.message || "Payment successful! Your booking is confirmed.");
        // After successful checkout, set an invoice URL (it will trigger a download or open a new tab)
        setInvoiceUrl(`/api/invoice?itineraryId=${itineraryId}`);
      }
    } catch (err) {
      setError("An error occurred while processing payment.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async () => {
    try {
      setLoading(true);
      setError("");
      const token = localStorage.getItem("accessToken");

      if (!token || !itineraryId) {
        router.push("/auth/login");
        return;
      }

      const response = await fetch(`/api/invoice?itineraryId=${itineraryId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
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
      console.error("Download error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-black shadow-md rounded">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Checkout</h1>

      {loading ? (
        <p className="text-gray-600">Loading order summary...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : order ? (
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">
            Order Summary (Itinerary #{order.id})
          </h2>
          <p className="text-gray-700 mb-2">
            <strong>Total Price:</strong> ${order.totalPrice.toFixed(2)}
          </p>
          <p className="text-gray-700 mb-2">
            <strong>Booking Date:</strong>{" "}
            {new Date(order.bookingDate).toLocaleString()}
          </p>
          <p className="text-gray-700 mb-2">
            <strong>Status:</strong> {order.status}
          </p>
          {/* You can render additional details (e.g. flight/hotel info) here if desired */}
        </div>
      ) : (
        <p className="text-gray-600"> Hi there! Please create your itinerary first :) </p>
      )}

      <form onSubmit={handlePaymentSubmit}>
        <div className="mb-4">
          <label className="block text-gray-700 mb-1">
            Card Number:
          </label>
          <input
            type="text"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            required
            placeholder="Enter card number"
            className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
          />
        </div>
        <div className="mb-6">
          <label className="block text-gray-700 mb-1">
            Card Expiry:
          </label>
          <input
            type="text"
            value={cardExpiry}
            onChange={(e) => setCardExpiry(e.target.value)}
            required
            placeholder="MM/YY"
            className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors"
        >
          {submitting ? "Processing Payment..." : "Submit Payment"}
        </button>
      </form>

      {message && <p className="text-green-600 mt-4">{message}</p>}

      {invoiceUrl && (
        <div className="mt-4">
          <button
            onClick={handleDownload}
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Download Invoice PDF
          </button>
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