"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface FlightBooking {
  id: number;
  flightDetails?: string; 
  itineraryId?: number | null;
}

interface HotelBooking {
  id: number;
  hotelDetails?: string; 
  itineraryId?: number | null;
}

export default function CreateItineraryPage() {
  const router = useRouter();
  const [flightBookings, setFlightBookings] = useState<FlightBooking[]>([]);
  const [hotelBookings, setHotelBookings] = useState<HotelBooking[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState<number | "">("");
  const [selectedHotelId, setSelectedHotelId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Fetch unlinked flight and hotel bookings for the logged-in user.
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/login");
      return;
    }
    const fetchBookings = async () => {
      setLoading(true);
      setError("");
      try {
        // Fetch flight bookings
        const resFlight = await fetch("/api/user/flight-bookings", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        const dataFlight = await resFlight.json();
        // Filter out bookings that are already linked to an itinerary.
        const unlinkedFlights = (dataFlight.bookings || []).filter(
          (booking: FlightBooking) => !booking.itineraryId
        );
        setFlightBookings(unlinkedFlights);

        // Fetch hotel bookings
        const resHotel = await fetch("/api/user/hotel-bookings", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        const dataHotel = await resHotel.json();
        const unlinkedHotels = (dataHotel.bookings || []).filter(
          (booking: HotelBooking) => !booking.itineraryId
        );
        setHotelBookings(unlinkedHotels);
      } catch (err: any) {
        setError(err.message || "Failed to fetch bookings.");
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, [router]);

  // Handler to create itinerary.
  const handleCreateItinerary = async () => {
    if (selectedFlightId === "" && selectedHotelId === "") {
      setError("Please select at least one reservation (flight or hotel).");
      return;
    }
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/login");
      return;
    }
    try {
      const res = await fetch("/api/itineraries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          flightReservationId: selectedFlightId !== "" ? selectedFlightId : null,
          hotelReservationId: selectedHotelId !== "" ? selectedHotelId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Itinerary creation failed.");
      } else {
        setMessage(data.message || "Itinerary created successfully.");
        // Redirect to itinerary details page.
        router.push(`/itineraries/${data.reservations.id}`);
      }
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white shadow-md rounded">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Create Itinerary</h1>
      {loading && <p className="text-gray-600">Loading bookings...</p>}
      {error && <p className="text-red-600">{error}</p>}
      {message && <p className="text-green-600">{message}</p>}
      
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Select Flight Reservation</h2>
        {flightBookings.length > 0 ? (
          <select
            value={selectedFlightId}
            onChange={(e) => setSelectedFlightId(Number(e.target.value))}
            className="w-full border border-gray-300 p-2 rounded"
          >
            <option value="">-- Select a Flight Booking --</option>
            {flightBookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {`Booking ID: ${booking.id} ${
                  booking.flightDetails ? `- ${booking.flightDetails}` : ""
                }`}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-gray-600">No unlinked flight bookings available.</p>
        )}
      </div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Select Hotel Reservation</h2>
        {hotelBookings.length > 0 ? (
          <select
            value={selectedHotelId}
            onChange={(e) => setSelectedHotelId(Number(e.target.value))}
            className="w-full border border-gray-300 p-2 rounded"
          >
            <option value="">-- Select a Hotel Booking --</option>
            {hotelBookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {`Booking ID: ${booking.id} ${
                  booking.hotelDetails ? `- ${booking.hotelDetails}` : ""
                }`}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-gray-600">No unlinked hotel bookings available.</p>
        )}
      </div>
      <button
        onClick={handleCreateItinerary}
        className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
      >
        Create Itinerary
      </button>
    </div>
  );
}
