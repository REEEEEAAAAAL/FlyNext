"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearAccessToken } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

interface RoomType {
    pricePerNight: number;
}

interface Hotel {
    id: number;
    name: string;
    logo: string | null;
    address: string;
    location: string;
    starRating: number;
    images: string[];
    roomTypes: RoomType[];
}

/**
 * Is this failure the "your account is not a hotel owner" gate?
 *
 * `GET /api/hotels/owner` answers `403` for a signed-in account that is not
 * flagged as an owner. That is a state, not an error: the traveller simply has no
 * listings yet, and the page owes them an invitation rather than a red line of
 * text. Matching on the status is what keeps this decision from depending on the
 * server's wording, which is free to change.
 */
function isNotAnOwner(status: number): boolean {
    return status === 403;
}

/**
 * The empty state shown when the caller has no listings.
 *
 * A 403 and an empty `hotels` array mean the same thing to the person reading the
 * page — "you have not listed anything yet" — so they share one presentation. The
 * panel is centred, uses the page's own card vocabulary rather than a bare
 * sentence, and leads with the one action that resolves it.
 */
function EmptyListings() {
    return (
        <div className="card mx-auto max-w-xl p-10 text-center">
            <span
                className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                aria-hidden="true"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-8 w-8"
                >
                    <path d="M3 21h18" />
                    <path d="M5 21V7l7-4 7 4v14" />
                    <path d="M9 21v-6h6v6" />
                </svg>
            </span>
            <h2 className="text-2xl font-bold heading">
                You haven&apos;t listed any hotels yet
            </h2>
            <p className="mx-auto mt-3 max-w-md muted">
                Become a host and your property can be booked by travellers
                searching FlyNext. Listing takes a couple of minutes: add the
                hotel, then add the room types you want to sell and how many of
                each are available.
            </p>
            <Link
                href="/hotels/new"
                className="mt-7 inline-block rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
                Create Your First Hotel
            </Link>
            <p className="mt-4 text-sm text-gray-500 dark:text-zinc-400">
                Already listed a property and not seeing it? Try clearing the
                filters below.
            </p>
        </div>
    );
}

export default function HotelList() {
    const router = useRouter();
    const { error: toastError } = useFeedback();
    const [hotels, setHotels] = useState<Hotel[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    /** Signed in, but the account carries no owner flag. */
    const [notAnOwner, setNotAnOwner] = useState(false);
    /** At least one successful load, so the empty state is not shown mid-flight. */
    const [loaded, setLoaded] = useState(false);

    // Filter states
    const [city, setCity] = useState("");
    const [name, setName] = useState("");
    const [starRating, setStarRating] = useState("");
    const [priceMin, setPriceMin] = useState("");
    const [priceMax, setPriceMax] = useState("");

    // Redirect to login if no access token is found.
    useEffect(() => {
        const fetchData = async () => {
            const token = localStorage.getItem("accessToken");
            if (!token) {
                // Redirect to login if no token found.
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

    const fetchHotels = async () => {
        setLoading(true);
        setError("");
        try {
            // Build query parameters based on filters.
            const params = new URLSearchParams();
            if (city) params.append("city", city);
            if (name) params.append("name", name);
            if (starRating) params.append("starRating", starRating);
            if (priceMin) params.append("priceMin", priceMin);
            if (priceMax) params.append("priceMax", priceMax);

            const token = localStorage.getItem("accessToken");
            const res = await fetch(`/api/hotels/owner?${params.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const data = await res.json().catch(() => null);

            if (!res.ok) {
                /*
                 * A `403` is the owner gate, and it is reported as the empty
                 * state rather than an error: "you have no listings yet" and "this
                 * account is not an owner" are the same situation from the
                 * traveller's side. Any other status is a real failure and stays
                 * red.
                 */
                if (isNotAnOwner(res.status)) {
                    setNotAnOwner(true);
                    setHotels([]);
                } else {
                    const failure = data?.error || "Failed to fetch hotels.";
                    setError(failure);
                    toastError("Could not load your listings", {
                        description: failure,
                    });
                }
            } else {
                setNotAnOwner(false);
                setHotels(data?.hotels ?? []);
            }
        } catch (err) {
            const failure = "An error occurred while fetching hotels.";
            setError(failure);
            toastError("Could not load your listings", { description: failure });
        } finally {
            setLoading(false);
            setLoaded(true);
        }
    };

    // Fetch hotels on component mount.
    useEffect(() => {
        fetchHotels();
    }, []);

    const handleFilterSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        fetchHotels();
    };

    // Helper to compute room price range.
    const getPriceRange = (roomTypes: RoomType[]) => {
        if (!roomTypes || roomTypes.length === 0) return null;
        const prices = roomTypes.map((rt) => rt.pricePerNight);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        return { minPrice, maxPrice };
    };

    /*
     * The empty state replaces the whole listings area, filters and all.
     *
     * Showing a filter form above "you have no hotels" invites the traveller to
     * filter a list that is empty for a reason no filter can change — and the
     * filters are what the empty state's own footnote tells them to clear, so
     * leaving the form visible there would be contradictory.
     */
    const showEmptyState = loaded && !error && hotels.length === 0;

    return (
        <div className="max-w-6xl mx-auto p-6">
            <h1 className="text-3xl font-bold mb-6 heading">Hotel Listings</h1>

            {showEmptyState ? (
                <EmptyListings />
            ) : (
                <>
                    {/* Filter Form in a Single Line */}
                    <form
                        onSubmit={handleFilterSubmit}
                        className="mb-6 flex flex-wrap gap-2 items-center"
                    >
                        <input
                            type="text"
                            placeholder="City"
                            aria-label="City"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            className="border p-2 rounded flex-1 min-w-[100px] dark:border-white/10 dark:bg-zinc-800"
                        />
                        <input
                            type="text"
                            placeholder="Hotel Name"
                            aria-label="Hotel Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="border p-2 rounded flex-1 min-w-[100px] dark:border-white/10 dark:bg-zinc-800"
                        />
                        <input
                            type="number"
                            placeholder="Star Rating"
                            aria-label="Star Rating"
                            value={starRating}
                            onChange={(e) => setStarRating(e.target.value)}
                            className="border p-2 rounded w-32 dark:border-white/10 dark:bg-zinc-800"
                        />
                        <input
                            type="number"
                            placeholder="Min Price"
                            aria-label="Minimum Price"
                            value={priceMin}
                            onChange={(e) => setPriceMin(e.target.value)}
                            className="border p-2 rounded w-32 dark:border-white/10 dark:bg-zinc-800"
                        />
                        <input
                            type="number"
                            placeholder="Max Price"
                            aria-label="Maximum Price"
                            value={priceMax}
                            onChange={(e) => setPriceMax(e.target.value)}
                            className="border p-2 rounded w-32 dark:border-white/10 dark:bg-zinc-800"
                        />
                        <button
                            type="submit"
                            className="bg-black text-white p-2 rounded whitespace-nowrap dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                        >
                            Filter
                        </button>
                    </form>

                    {/* Create New Hotel Button */}
                    <div className="mb-6 text-right">
                        <Link
                            href="/hotels/new"
                            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors"
                        >
                            Create New Hotel
                        </Link>
                    </div>

                    {loading && <p className="muted">Loading hotels...</p>}
                    {error && (
                        <p className="text-red-500 dark:text-red-400">{error}</p>
                    )}

                    {/* Hotels List */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {hotels.map((hotel) => {
                            const priceRange = getPriceRange(hotel.roomTypes);
                            return (
                                <Link key={hotel.id} href={`/hotels/${hotel.id}/edit`}>
                                    <div className="border p-4 rounded shadow hover:shadow-md dark:bg-zinc-900 dark:border-white/10 dark:shadow-none dark:hover:border-white/20 transition cursor-pointer">
                                        {hotel.logo && (
                                            <img
                                                src={hotel.logo}
                                                alt={hotel.name}
                                                className="w-full h-40 object-cover mb-4 rounded"
                                            />
                                        )}
                                        <h2 className="text-xl font-semibold mb-2 heading">
                                            {hotel.name}
                                        </h2>
                                        <p className="text-gray-700 dark:text-zinc-200 mb-1">
                                            {hotel.address}
                                        </p>
                                        <p className="text-gray-700 dark:text-zinc-200 mb-1">
                                            {hotel.location}
                                        </p>
                                        <p className="text-gray-700 dark:text-zinc-200 mb-1">
                                            Star Rating: {hotel.starRating}
                                        </p>
                                        {priceRange && (
                                            <p className="text-gray-700 dark:text-zinc-200 mt-2">
                                                Price from ${priceRange.minPrice} to $
                                                {priceRange.maxPrice}
                                            </p>
                                        )}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
