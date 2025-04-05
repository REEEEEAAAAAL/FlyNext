"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<"flights" | "hotels">("flights");
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Check for authentication on mount.
    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        setIsAuthenticated(!!token);
    }, []);

    const handleLogout = async () => {
        try {
            const token = localStorage.getItem("accessToken");
            const res = await fetch("/api/auth/logout", {
                method: "POST",
                headers: {
                    Authorization: token ? `Bearer ${token}` : "",
                },
            });
            if (res.ok) {
                localStorage.removeItem("accessToken");
                router.push("/auth/login");
            }
        } catch (error) {
            console.error("Logout failed:", error);
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--text)]">
            {/* Main content set to flex-grow so it takes available space */}
            <main className="container mx-auto p-6 flex-grow max-w-7xl px-4 sm:px-6 lg:px-8">
                {/* Navigation Tabs for Primary Search */}
                <div className="flex justify-center space-x-4 mb-8">
                    <button
                        onClick={() => setActiveTab("flights")}
                        className={`px-6 py-2 rounded transition-colors font-semibold ${
                            activeTab === "flights"
                                ? "bg-black text-white"
                                : "bg-white text-black border border-gray-300 hover:bg-gray-200"
                        }`}
                    >
                        Flight Search
                    </button>
                    <button
                        onClick={() => setActiveTab("hotels")}
                        className={`px-6 py-2 rounded transition-colors font-semibold ${
                            activeTab === "hotels"
                                ? "bg-black text-white"
                                : "bg-white text-black border border-gray-300 hover:bg-gray-200"
                        }`}
                    >
                        Hotel Search
                    </button>
                </div>

                {/* Tab Content */}
                <section className="mb-12">
                    {activeTab === "flights" ? (
                        <div className="text-center">
                            <h2 className="text-2xl font-bold mb-4 text-[var(--text)]">
                                Search for Flights
                            </h2>
                            <p className="text-[var(--text)] mb-6">
                                Find the best flights for your journey by
                                clicking the button below.
                            </p>
                            <Link
                                href="/flights"
                                className="px-6 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors"
                            >
                                Go to Flight Search
                            </Link>
                        </div>
                    ) : (
                        <div className="text-center">
                            <h2 className="text-2xl font-bold mb-4 text-[var(--text)]">
                                Search for Hotels
                            </h2>
                            <p className="text-[var(--text)] mb-6">
                                Discover the perfect hotel for your stay. Click
                                below to start your search.
                            </p>
                            <Link
                                href="/hotels"
                                className="px-6 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors"
                            >
                                Go to Hotel Search
                            </Link>
                        </div>
                    )}
                </section>

                {/* Additional Functionalities */}
                <section>
                    <h2 className="text-2xl font-bold mb-4 text-[var(--text)]">
                        Explore More
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Itineraries */}
                        <Link
                            href="/itineraries"
                            className="block p-6 bg-white  border border-gray-300 dark:border-gray-600 rounded shadow hover:shadow-md transition-shadow"
                        >
                            <h3 className="text-xl font-semibold mb-2 text-[var(--text)]">
                                Itineraries
                            </h3>
                            <p className="text-[var(--text)]">
                                View all your trip plans and manage your
                                bookings.
                            </p>
                        </Link>
                        {/* Create Itinerary */}
                        <Link
                            href="/itineraries/new"
                            className="block p-6 bg-white border border-gray-300 dark:border-gray-600 rounded shadow hover:shadow-md transition-shadow"
                        >
                            <h3 className="text-xl font-semibold mb-2 text-[var(--text)]">
                                Create Itinerary
                            </h3>
                            <p className="text-[var(--text)]">
                                Combine your flight and hotel bookings into an
                                itinerary.
                            </p>
                        </Link>
                        {/* Checkout */}
                        <Link
                            href="/checkout"
                            className="block p-6 bg-white border border-gray-300 dark:border-gray-600 rounded shadow hover:shadow-md transition-shadow"
                        >
                            <h3 className="text-xl font-semibold mb-2 text-[var(--text)]">
                                Checkout
                            </h3>
                            <p className="text-[var(--text)]">
                                Review your order summary and complete your
                                booking.
                            </p>
                        </Link>
                        {/* Flight Bookings */}
                        <Link
                            href="/user/flight-bookings"
                            className="block p-6 bg-white border border-gray-300 dark:border-gray-600 rounded shadow hover:shadow-md transition-shadow"
                        >
                            <h3 className="text-xl font-semibold mb-2 text-[var(--text)]">
                                Flight Bookings
                            </h3>
                            <p className="text-[var(--text)]">
                                View details of your flight reservations.
                            </p>
                        </Link>
                        {/* Hotel Bookings */}
                        <Link
                            href="/user/hotel-bookings"
                            className="block p-6 bg-white border border-gray-300 dark:border-gray-600 rounded shadow hover:shadow-md transition-shadow"
                        >
                            <h3 className="text-xl font-semibold mb-2 text-[var(--text)]">
                                Hotel Bookings
                            </h3>
                            <p className="text-[var(--text)]">
                                Check your hotel reservations and manage
                                changes.
                            </p>
                        </Link>
                        {/* Hotel Management */}
                        <Link
                            href="/hotels/owner"
                            className="block p-6 bg-white border border-gray-300 dark:border-gray-600 rounded shadow hover:shadow-md transition-shadow"
                        >
                            <h3 className="text-xl font-semibold mb-2 text-[var(--text)]">
                                Hotel Management
                            </h3>
                            <p className="text-[var(--text)]">Manage your hotels.</p>
                        </Link>
                    </div>
                </section>
            </main>

            {/* Footer always at bottom */}
            <footer className="bg-[var(--background)] text-center p-4">
                <p className="text-sm text-[var(--text)]">
                    &copy; {new Date().getFullYear()} FlyNext. All rights
                    reserved.
                </p>
            </footer>
        </div>
    );
}
