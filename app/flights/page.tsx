"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Define Flight interface based on your API response.
interface Flight {
    id: string;
    flightNumber?: string;
    departureTime?: string;
    arrivalTime?: string;
    price: number;
    duration?: number; // in minutes
    availableSeats?: number;
    airline?: {
        code: string;
        name: string;
    };
    origin?: {
        code: string;
        name: string;
        city: string;
        country: string;
    };
    destination?: {
        code: string;
        name: string;
        city: string;
        country: string;
    };
}

// Define FlightGroup interface for grouped flights (direct or connecting)
interface FlightGroup {
    legs: number;
    flights: Flight[];
    totalPrice?: number;
    totalDuration?: number;
}

// Define Airport interface for suggestions.
interface Airport {
    id: number;
    code: string;
    name: string;
    city: string;
    country: string;
}

// Helper function to format duration.
const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
};

const generateGroupId = (flights: Flight[]) => {
    return flights.map((f) => f.id).join("|");
};

export default function FlightSearchPage() {
    const router = useRouter();
    const [tripType, setTripType] = useState<"one-way" | "round-trip">("one-way");

    // Outbound search fields.
    const [origin, setOrigin] = useState("");
    const [destination, setDestination] = useState("");
    const [date, setDate] = useState("");

    // Return search field (for round-trip).
    const [returnDate, setReturnDate] = useState("");

    // Flight results for outbound and return.
    const [outboundFlightGroups, setOutboundFlightGroups] = useState<FlightGroup[]>([]);
    const [returnFlightGroups, setReturnFlightGroups] = useState<FlightGroup[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // For auto-suggestions.
    const [originSuggestions, setOriginSuggestions] = useState<Airport[]>([]);
    const [destinationSuggestions, setDestinationSuggestions] = useState<Airport[]>([]);
    const [showOriginDropdown, setShowOriginDropdown] = useState(false);
    const [showDestinationDropdown, setShowDestinationDropdown] = useState(false);

    // For selected flight group IDs (for round-trip booking).
    const [selectedOutboundGroupIds, setSelectedOutboundGroupIds] = useState<string[]>([]);
    const [selectedReturnGroupIds, setSelectedReturnGroupIds] = useState<string[]>([]);

    const toggleOutboundGroupSelection = (flights: Flight[]) => {
        const groupId = generateGroupId(flights);
        setSelectedOutboundGroupIds((prev) =>
            prev.includes(groupId)
                ? prev.filter((id) => id !== groupId)
                : [...prev, groupId]
        );
    };

    const toggleReturnGroupSelection = (flights: Flight[]) => {
        const groupId = generateGroupId(flights);
        setSelectedReturnGroupIds((prev) =>
            prev.includes(groupId)
                ? prev.filter((id) => id !== groupId)
                : [...prev, groupId]
        );
    };

    // Redirect to login if not logged in.
    const ensureLoggedIn = async (): Promise<boolean> => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/auth/login");
            return false;
        }
        const response = await fetch("/api/user", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (response.status === 401) {
            localStorage.removeItem("accessToken");
            router.push("/auth/refresh");
            return false;
        }
        return true;
    };

    // Fetch suggestions from /api/locations/airports?q=...
    const fetchSuggestions = async (query: string): Promise<Airport[]> => {
        try {
            const res = await fetch(`/api/locations/airports?q=${encodeURIComponent(query)}`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });
            if (res.ok) {
                const data = await res.json();
                return data.airports || [];
            }
        } catch (err) {
            console.error("Error fetching suggestions", err);
        }
        return [];
    };

    // Handlers for origin/destination input changes.
    const handleOriginChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setOrigin(value);
        if (value.length >= 2) {
            const suggestions = await fetchSuggestions(value);
            setOriginSuggestions(suggestions);
            setShowOriginDropdown(true);
        } else {
            setOriginSuggestions([]);
            setShowOriginDropdown(false);
        }
    };

    const handleDestinationChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setDestination(value);
        if (value.length >= 2) {
            const suggestions = await fetchSuggestions(value);
            setDestinationSuggestions(suggestions);
            setShowDestinationDropdown(true);
        } else {
            setDestinationSuggestions([]);
            setShowDestinationDropdown(false);
        }
    };

    const selectOriginSuggestion = (airport: Airport) => {
        setOrigin(airport.code);
        setOriginSuggestions([]);
        setShowOriginDropdown(false);
    };

    const selectDestinationSuggestion = (airport: Airport) => {
        setDestination(airport.code);
        setDestinationSuggestions([]);
        setShowDestinationDropdown(false);
    };

    // Function to perform flight search.
    const performFlightSearch = async (
        origin: string,
        destination: string,
        date: string
    ): Promise<FlightGroup[]> => {
        const query = new URLSearchParams({
            origin,
            destination,
            date,
        }).toString();
        const res = await fetch(`/api/flights/search?${query}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Flight search failed");
        }

        const data = await res.json();

        // Process flight groups to calculate total price and duration for connecting flights.
        const processedGroups = data.map((group: any) => {
            const totalPrice = group.flights.reduce(
                (sum: number, flight: Flight) => sum + flight.price,
                0
            );
            const totalDuration = group.flights.reduce(
                (sum: number, flight: Flight) => sum + (flight.duration || 0),
                0
            );

            return {
                ...group,
                totalPrice,
                totalDuration,
            };
        });

        return processedGroups;
    };

    const handleSearch = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setOutboundFlightGroups([]);
        setReturnFlightGroups([]);
        setSelectedOutboundGroupIds([]);
        setSelectedReturnGroupIds([]);

        try {
            const outbound = await performFlightSearch(origin, destination, date);
            setOutboundFlightGroups(outbound);

            if (tripType === "round-trip" && returnDate) {
                const inbound = await performFlightSearch(destination, origin, returnDate);
                setReturnFlightGroups(inbound);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Helper function to fetch user info from the backend.
    const fetchUserInfo = async () => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            throw new Error("User not logged in");
        }
        const res = await fetch("/api/user", {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to fetch user info");
        }
        const data = await res.json();
        return data.user;
    };

    // Handle booking for one-way flights.
    const handleBookOneWay = async (flights: Flight[]) => {
        if (!(await ensureLoggedIn()) || flights.length === 0) return;

        const groupId = generateGroupId(flights);
        setSelectedOutboundGroupIds([groupId]);

        try {
            const user = await fetchUserInfo();
            const token = localStorage.getItem("accessToken")!;
            const res = await fetch("/api/flights/book", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    passportNumber: "ABC123456",
                    flightIds: flights.map((f) => f.id),
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                alert("Booking failed: " + (data.error || "Unknown error"));
            } else {
                const data = await res.json();
                alert("Booking successful! Reservation ID: " + data.reservationId);
            }
        } catch (error: any) {
            alert("An error occurred while booking the flight: " + error.message);
        }
    };

    // Handle booking for round-trip flights.
    const handleBookRoundTrip = async () => {
        if (
            !(await ensureLoggedIn()) ||
            selectedOutboundGroupIds.length === 0 ||
            selectedReturnGroupIds.length === 0
        )
            return;

        // Get all flight IDs from the selected groups.
        const allFlightIds = [
            ...selectedOutboundGroupIds.flatMap((id) => id.split("|")),
            ...selectedReturnGroupIds.flatMap((id) => id.split("|")),
        ];

        try {
            const user = await fetchUserInfo();
            const token = localStorage.getItem("accessToken")!;
            const res = await fetch("/api/flights/book", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    passportNumber: "ABC123456",
                    flightIds: allFlightIds,
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                alert("Booking failed: " + (data.error || "Unknown error"));
            } else {
                const data = await res.json();
                alert("Booking successful! Reservation ID: " + data.reservationId);
            }
        } catch (error: any) {
            alert("An error occurred while booking the flight: " + error.message);
        }
    };

    // Render flight details including city information.
    const renderFlightDetails = (flight: Flight) => (
        <div className="mb-4 pl-4 border-l-2 border-gray-300">
            <p className="text-gray-800">
                <strong>Flight Number:</strong> {flight.flightNumber || "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Airline:</strong> {flight.airline ? flight.airline.name : "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Departure:</strong>{" "}
                {flight.departureTime ? new Date(flight.departureTime).toLocaleString() : "N/A"}
                {flight.origin && ` (${flight.origin.code} - ${flight.origin.city})`}
            </p>
            <p className="text-gray-800">
                <strong>Arrival:</strong>{" "}
                {flight.arrivalTime ? new Date(flight.arrivalTime).toLocaleString() : "N/A"}
                {flight.destination && ` (${flight.destination.code} - ${flight.destination.city})`}
            </p>
            <p className="text-gray-800">
                <strong>Duration:</strong>{" "}
                {flight.duration != null ? formatDuration(flight.duration) : "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Available Seats:</strong>{" "}
                {flight.availableSeats != null ? flight.availableSeats : "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Price:</strong>{" "}
                {flight.price != null ? `$${flight.price.toFixed(2)}` : "N/A"}
            </p>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto p-8 bg-white shadow-md rounded">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">Flight Search</h1>

            {/* Trip Type Toggle */}
            <div className="flex space-x-4 mb-6">
                <button
                    className={`px-4 py-2 rounded ${tripType === "one-way" ? "bg-black text-white" : "bg-gray-200 text-gray-800"}`}
                    onClick={() => setTripType("one-way")}
                >
                    One‑way
                </button>
                <button
                    className={`px-4 py-2 rounded ${tripType === "round-trip" ? "bg-black text-white" : "bg-gray-200 text-gray-800"}`}
                    onClick={() => setTripType("round-trip")}
                >
                    Round Trip
                </button>
            </div>

            <form onSubmit={handleSearch} className="mb-6 space-y-4">
                {/* Outbound Flight Inputs */}
                <div className="relative">
                    <label className="block text-gray-700">Origin:</label>
                    <input
                        type="text"
                        value={origin}
                        onChange={handleOriginChange}
                        placeholder="e.g., YYZ"
                        required
                        className="w-full border border-gray-300 p-2 rounded text-black"
                        onFocus={() => origin.length >= 2 && setShowOriginDropdown(true)}
                        onBlur={() => setTimeout(() => setShowOriginDropdown(false), 150)}
                    />
                    {showOriginDropdown && originSuggestions.length > 0 && (
                        <ul className="absolute z-10 bg-white border border-gray-300 w-full max-h-60 overflow-y-auto text-gray-900">
                            {originSuggestions.map((airport) => (
                                <li
                                    key={airport.id}
                                    onClick={() => selectOriginSuggestion(airport)}
                                    className="p-2 hover:bg-gray-200 cursor-pointer"
                                >
                                    {airport.code} - {airport.name} ({airport.city}, {airport.country})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="relative">
                    <label className="block text-gray-700">Destination:</label>
                    <input
                        type="text"
                        value={destination}
                        onChange={handleDestinationChange}
                        placeholder="e.g., CAN"
                        required
                        className="w-full border border-gray-300 p-2 rounded text-black"
                        onFocus={() => destination.length >= 2 && setShowDestinationDropdown(true)}
                        onBlur={() => setTimeout(() => setShowDestinationDropdown(false), 150)}
                    />
                    {showDestinationDropdown && destinationSuggestions.length > 0 && (
                        <ul className="absolute z-10 bg-white border border-gray-300 w-full max-h-60 overflow-y-auto text-gray-900">
                            {destinationSuggestions.map((airport) => (
                                <li
                                    key={airport.id}
                                    onClick={() => selectDestinationSuggestion(airport)}
                                    className="p-2 hover:bg-gray-200 cursor-pointer"
                                >
                                    {airport.code} - {airport.name} ({airport.city}, {airport.country})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div>
                    <label className="block text-gray-700">Outbound Date:</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        className="w-full border border-gray-300 p-2 rounded text-black"
                    />
                </div>
                {tripType === "round-trip" && (
                    <div>
                        <label className="block text-gray-700">Return Date:</label>
                        <input
                            type="date"
                            value={returnDate}
                            onChange={(e) => setReturnDate(e.target.value)}
                            required
                            className="w-full border border-gray-300 p-2 rounded text-black"
                        />
                    </div>
                )}
                <button type="submit" className="px-6 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors">
                    Search Flights
                </button>
            </form>

            {loading && <p className="text-gray-600">Loading flights...</p>}
            {error && <p className="text-red-600">{error}</p>}

            {/* Outbound Flight Results */}
            {outboundFlightGroups.length > 0 && (
                <div className="mb-6">
                    <h2 className="text-2xl font-semibold mb-4 text-gray-800">Outbound Flights</h2>
                    <ul className="space-y-6">
                        {outboundFlightGroups.map((group, groupIndex) => (
                            <li key={groupIndex} className="p-6 border border-gray-300 rounded bg-gray-50">
                                <div className="mb-4">
                                    <p className="text-lg font-semibold">
                                        {group.legs === 1 ? "Direct Flight" : `${group.legs - 1} Stop${group.legs > 2 ? "s" : ""}`}
                                    </p>
                                    <p className="text-gray-800">
                                        <strong>Total Price:</strong> ${group.totalPrice?.toFixed(2) || "N/A"}
                                    </p>
                                    <p className="text-gray-800">
                                        <strong>Total Duration:</strong>{" "}
                                        {group.totalDuration != null ? formatDuration(group.totalDuration) : "N/A"}
                                    </p>
                                </div>
                                {group.flights.map((flight, flightIndex) => (
                                    <div key={flight.id ?? flightIndex}>
                                        {flightIndex > 0 && (
                                            <div className="my-4 text-center text-sm text-gray-500">
                                                Layover at {flight.origin?.city} ({flight.origin?.code})
                                            </div>
                                        )}
                                        {renderFlightDetails(flight)}
                                    </div>
                                ))}
                                {tripType === "one-way" && (
                                    <button
                                        onClick={() => handleBookOneWay(group.flights)}
                                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                    >
                                        Book One‑Way
                                    </button>
                                )}
                                {tripType === "round-trip" && (
                                    <div className="mt-4">
                                        <label className="inline-flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedOutboundGroupIds.includes(generateGroupId(group.flights))}
                                                onChange={() => toggleOutboundGroupSelection(group.flights)}
                                                className="form-checkbox text-blue-600"
                                            />
                                            <span className="ml-2">Select as Outbound</span>
                                        </label>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Return Flight Results for Round Trip */}
            {tripType === "round-trip" && (
                <div className="mb-6">
                    <h2 className="text-2xl font-semibold mb-4 text-gray-800">Return Flights</h2>
                    {returnFlightGroups.length > 0 ? (
                        <ul className="space-y-6">
                            {returnFlightGroups.map((group, groupIndex) => (
                                <li key={groupIndex} className="p-6 border border-gray-300 rounded bg-gray-50">
                                    <div className="mb-4">
                                        <p className="text-lg font-semibold">
                                            {group.legs === 1 ? "Direct Flight" : `${group.legs - 1} Stop${group.legs > 2 ? "s" : ""}`}
                                        </p>
                                        <p className="text-gray-800">
                                            <strong>Total Price:</strong> ${group.totalPrice?.toFixed(2) || "N/A"}
                                        </p>
                                        <p className="text-gray-800">
                                            <strong>Total Duration:</strong>{" "}
                                            {group.totalDuration != null ? formatDuration(group.totalDuration) : "N/A"}
                                        </p>
                                    </div>
                                    {group.flights.map((flight, flightIndex) => (
                                        <div key={flight.id ?? flightIndex}>
                                            {flightIndex > 0 && (
                                                <div className="my-4 text-center text-sm text-gray-500">
                                                    Layover at {flight.origin?.city} ({flight.origin?.code})
                                                </div>
                                            )}
                                            {renderFlightDetails(flight)}
                                        </div>
                                    ))}
                                    <div className="mt-4">
                                        <label className="inline-flex items-center">
                                            <input
                                                type="checkbox"
                                                name="selectedReturn"
                                                checked={selectedReturnGroupIds.includes(generateGroupId(group.flights))}
                                                onChange={() => toggleReturnGroupSelection(group.flights)}
                                                className="form-checkbox text-blue-600"
                                            />
                                            <span className="ml-2">Select as Return</span>
                                        </label>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-gray-600">No return flights found.</p>
                    )}
                    {selectedOutboundGroupIds.length > 0 && selectedReturnGroupIds.length > 0 && (
                        <button
                            onClick={handleBookRoundTrip}
                            className="mt-6 px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                            Book Round Trip
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// Helper function to render flight details.
function renderFlightDetails(flight: Flight) {
    return (
        <div className="mb-4 pl-4 border-l-2 border-gray-300">
            <p className="text-gray-800">
                <strong>Flight Number:</strong> {flight.flightNumber || "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Airline:</strong> {flight.airline ? flight.airline.name : "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Departure:</strong>{" "}
                {flight.departureTime ? new Date(flight.departureTime).toLocaleString() : "N/A"}
                {flight.origin && ` (${flight.origin.code} - ${flight.origin.city})`}
            </p>
            <p className="text-gray-800">
                <strong>Arrival:</strong>{" "}
                {flight.arrivalTime ? new Date(flight.arrivalTime).toLocaleString() : "N/A"}
                {flight.destination && ` (${flight.destination.code} - ${flight.destination.city})`}
            </p>
            <p className="text-gray-800">
                <strong>Duration:</strong>{" "}
                {flight.duration != null ? formatDuration(flight.duration) : "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Available Seats:</strong>{" "}
                {flight.availableSeats != null ? flight.availableSeats : "N/A"}
            </p>
            <p className="text-gray-800">
                <strong>Price:</strong>{" "}
                {flight.price != null ? `$${flight.price.toFixed(2)}` : "N/A"}
            </p>
        </div>
    );
}
