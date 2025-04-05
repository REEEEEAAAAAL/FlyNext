"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface RoomType {
    pricePerNight: number;
    // add other fields if needed
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

export default function HotelList() {
    const router = useRouter();
    const [hotels, setHotels] = useState<Hotel[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

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
                localStorage.removeItem("accessToken");

                // Instead of going directly to login, go to refresh page
                router.push("/auth/refresh");
                return;
            }
            
            // const data = await response.json();
            // if (data.user.IsHotelOwner === false) {
            //     router.push("/");
            //     return;
            // }
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
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || "Failed to fetch hotels.");
            } else {
                setHotels(data.hotels);
            }
        } catch (err) {
            setError("An error occurred while fetching hotels.");
        } finally {
            setLoading(false);
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

    return (
        <div className="max-w-6xl mx-auto p-6">
            <h1 className="text-3xl font-bold mb-6">Hotel Listings</h1>

            {/* Filter Form in a Single Line */}
            <form
                onSubmit={handleFilterSubmit}
                className="mb-6 flex flex-wrap gap-2 items-center"
            >
                <input
                    type="text"
                    placeholder="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="border p-2 rounded flex-1 min-w-[100px]"
                />
                <input
                    type="text"
                    placeholder="Hotel Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="border p-2 rounded flex-1 min-w-[100px]"
                />
                <input
                    type="number"
                    placeholder="Star Rating"
                    value={starRating}
                    onChange={(e) => setStarRating(e.target.value)}
                    className="border p-2 rounded w-32"
                />
                <input
                    type="number"
                    placeholder="Min Price"
                    value={priceMin}
                    onChange={(e) => setPriceMin(e.target.value)}
                    className="border p-2 rounded w-32"
                />
                <input
                    type="number"
                    placeholder="Max Price"
                    value={priceMax}
                    onChange={(e) => setPriceMax(e.target.value)}
                    className="border p-2 rounded w-32"
                />
                <button
                    type="submit"
                    className="bg-black text-white p-2 rounded whitespace-nowrap"
                >
                    Filter
                </button>
            </form>

            {/* Create New Hotel Button */}
            <div className="mb-6 text-right">
                <Link
                    href="/hotels/new"
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
                >
                    Create New Hotel
                </Link>
            </div>

            {loading && <p>Loading hotels...</p>}
            {error && <p className="text-red-500">{error}</p>}

            {/* Hotels List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {hotels.map((hotel) => {
                    const priceRange = getPriceRange(hotel.roomTypes);
                    return (
                        <Link key={hotel.id} href={`/hotels/${hotel.id}/edit`}>
                            <div className="border p-4 rounded shadow hover:shadow-md transition cursor-pointer">
                                {hotel.logo && (
                                    <img
                                        src={hotel.logo}
                                        alt={hotel.name}
                                        className="w-full h-40 object-cover mb-4 rounded"
                                    />
                                )}
                                <h2 className="text-xl font-semibold mb-2">
                                    {hotel.name}
                                </h2>
                                <p className="text-gray-700 mb-1">
                                    {hotel.address}
                                </p>
                                <p className="text-gray-700 mb-1">
                                    {hotel.location}
                                </p>
                                <p className="text-gray-700 mb-1">
                                    Star Rating: {hotel.starRating}
                                </p>
                                {priceRange && (
                                    <p className="text-gray-700 mt-2">
                                        Price from ${priceRange.minPrice} to $
                                        {priceRange.maxPrice}
                                    </p>
                                )}
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
