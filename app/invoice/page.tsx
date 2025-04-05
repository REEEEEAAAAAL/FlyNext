"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function InvoicePageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const itineraryId = searchParams.get("itineraryId");

    const [pdfUrl, setPdfUrl] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Protect the page: redirect to login if no JWT found.
    useEffect(() => {
        const fetchData = async () => {
            const token = localStorage.getItem("accessToken");
            if (!token) {
                // Redirect to login if no token found.
                return;
            }

            const response = await fetch("/api/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.status === 401) {
                // Token expired or invalid - try refreshing
                localStorage.removeItem("accessToken");
                // Instead of going directly to login, go to refresh page
                router.push("/auth/refresh");
                return;
            }
        };

        fetchData();
    }, [router]);

    // Fetch the invoice PDF using the itineraryId.
    useEffect(() => {
        if (!itineraryId) {
            setError("Missing itinerary identifier.");
            return;
        }
        const fetchInvoice = async () => {
            setLoading(true);
            setError("");
            try {
                const token = localStorage.getItem("accessToken");
                const res = await fetch(
                    `/api/invoice?itineraryId=${itineraryId}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: token ? `Bearer ${token}` : "",
                        },
                    }
                );
                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || "Failed to generate invoice.");
                } else {
                    // Assume the backend returns the invoice as PDF content in binary form.
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    setPdfUrl(url);
                }
            } catch (err) {
                setError("An error occurred while generating the invoice.");
            } finally {
                setLoading(false);
            }
        };

        fetchInvoice();
    }, [itineraryId]);

    return (
        <div className="max-w-4xl mx-auto p-8 bg-white text-black shadow-md rounded">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">Invoice</h1>
            {loading && <p className="text-gray-600">Generating invoice...</p>}
            {error && <p className="text-red-600">{error}</p>}
            {pdfUrl && (
                <iframe
                    src={pdfUrl}
                    title="Invoice"
                    className="w-full h-[80vh] border rounded"
                />
            )}
            {!loading && !error && !pdfUrl && (
                <p className="text-gray-600">No invoice available.</p>
            )}
        </div>
    );
}

export default function InvoicePage() {
    return (
        <Suspense fallback={<div>Loading invoice...</div>}>
            <InvoicePageContent />
        </Suspense>
    );
}
