"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { clearAccessToken } from "@/app/lib/session";

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
                /*
                 * Navigating on the no-token branch is what keeps a logged-out
                 * visitor off the page entirely: returning without navigating
                 * would leave them on it, looking at the invoice request's own red
                 * "Unauthorized" with no way forward.
                 */
                router.push("/auth/login");
                return;
            }

            const response = await fetch("/api/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.status === 401) {
                // Token expired or invalid - try refreshing
                clearAccessToken();
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
        /*
         * Each fetch produces a fresh blob URL for the whole PDF. `pdfUrl` holds
         * only the current one, so the URL a run creates has no other reference —
         * the cleanup below is what revokes it, when this run is replaced or the
         * page unmounts.
         */
        let objectUrl: string | null = null;
        let cancelled = false;

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
                if (res.status === 401) {
                    clearAccessToken();
                    router.push("/auth/refresh");
                    return;
                }
                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || "Failed to generate invoice.");
                } else {
                    // The route answers with the PDF as binary content.
                    const blob = await res.blob();
                    if (cancelled) {
                        return;
                    }
                    objectUrl = URL.createObjectURL(blob);
                    setPdfUrl(objectUrl);
                }
            } catch {
                if (!cancelled) {
                    setError("An error occurred while generating the invoice.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchInvoice();

        return () => {
            cancelled = true;
            if (objectUrl !== null) {
                URL.revokeObjectURL(objectUrl);
            }
            setPdfUrl("");
        };
    }, [itineraryId, router]);

    return (
        <div className="max-w-4xl mx-auto p-8 card text-[var(--text)]">
            <h1 className="text-3xl font-bold mb-6 heading">Invoice</h1>
            {loading && <p className="muted">Generating invoice...</p>}
            {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
            {pdfUrl && (
                /*
                 * A PDF viewer paints its own white page, so the frame keeps a
                 * light-neutral background: an "invisible" dark frame would sit
                 * around a white document and read as a rendering fault. The border
                 * is what adapts.
                 */
                <iframe
                    src={pdfUrl}
                    title="Invoice"
                    /* bg-white is the PDF page colour, not a themed surface */
                    className="w-full h-[80vh] rounded border border-gray-300 dark:border-white/15 bg-white"
                />
            )}
            {!loading && !error && !pdfUrl && (
                <p className="muted">No invoice available.</p>
            )}
        </div>
    );
}

export default function InvoicePage() {
    return (
        <Suspense
            fallback={
                <div className="max-w-4xl mx-auto p-8 card muted">
                    Loading invoice...
                </div>
            }
        >
            <InvoicePageContent />
        </Suspense>
    );
}
