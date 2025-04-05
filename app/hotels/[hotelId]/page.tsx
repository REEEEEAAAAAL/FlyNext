"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";

interface RoomType {
  id: string;
  name: string;
  description: string;
  pricePerNight: number;
  capacity: number;
  currentAvailability: number;
  amenities?: string;
}

interface Hotel {
  id: string;
  name: string;
  address: string;
  location: string;
  starRating: number;
  logo?: string;
  images?: string[];
  roomTypes?: RoomType[];
}

export default function HotelDetailsPage() {
  const { hotelId } = useParams();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hotelId) return;
    const fetchHotelDetails = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/hotels/${hotelId}`, { method: "GET" });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Error fetching hotel details.");
        } else {
          // API returns { hotel: { ... } }
          setHotel(data.hotel);
        }
      } catch (err) {
        setError("An error occurred while fetching hotel details.");
      } finally {
        setLoading(false);
      }
    };
    fetchHotelDetails();
  }, [hotelId]);

  // Helper: Render star rating as stars.
  const renderStars = (rating: number) =>
    "★".repeat(rating) + "☆".repeat(5 - rating);

  return (
    <div className="max-w-5xl mx-auto p-8 bg-white shadow-lg rounded-lg">
      {loading && <p className="text-gray-600">Loading hotel details...</p>}
      {error && <p className="text-red-600">{error}</p>}
      {hotel ? (
        <>
          <div className="flex flex-col md:flex-row items-center">
            {hotel.logo && (
              <div className="w-32 h-32 relative mr-6 mb-4 md:mb-0">
                <Image
                  src={hotel.logo}
                  alt={`${hotel.name} logo`}
                  fill
                  className="object-cover rounded-full"
                />
              </div>
            )}
            <div>
              <h1 className="text-4xl font-bold text-gray-800">{hotel.name}</h1>
              <p className="mt-2 text-gray-600">
                <strong>Address:</strong> {hotel.address}
              </p>
              <p className="mt-1 text-gray-600">
                <strong>Location:</strong> {hotel.location}
              </p>
              <p className="mt-1 text-gray-600">
                <strong>Star Rating:</strong>{" "}
                <span className="text-yellow-500">{renderStars(hotel.starRating)}</span>
              </p>
            </div>
          </div>
          {/* Gallery Section */}
          <div className="mt-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Gallery</h2>
            {hotel.images && hotel.images.length > 0 ? (
              <div className="flex space-x-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-400">
                {hotel.images.map((imgUrl, index) => (
                  <div key={index} className="relative w-64 h-48 flex-shrink-0">
                    <Image
                      src={imgUrl}
                      alt={`Image ${index + 1} of ${hotel.name}`}
                      fill
                      className="object-cover rounded shadow-md"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 border rounded text-center text-gray-500">
                No images available.
              </div>
            )}
          </div>
          {/* Room Types Section */}
          {hotel.roomTypes && hotel.roomTypes.length > 0 && (
            <div className="mt-8">
              <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                Available Room Types
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {hotel.roomTypes.map((room) => (
                  <Link
                    key={room.id}
                    href={`/hotels/${hotel.id}/room-types/${room.id}`}
                    className="block p-4 border rounded-lg bg-white hover:shadow-xl transition duration-300"
                  >
                    <h3 className="text-xl font-bold text-gray-800">
                      {room.name}
                    </h3>
                    <p className="text-gray-600 text-sm mt-1">
                      {room.description}
                    </p>
                    <p className="text-gray-600 text-sm mt-1">
                      <strong>Capacity:</strong> {room.capacity}{" "}
                      {room.capacity === 1 ? "person" : "people"}
                    </p>
                    <p className="text-gray-600 text-sm mt-1">
                      <strong>Price:</strong> ${room.pricePerNight}/night
                    </p>
                    <p className="text-gray-600 text-sm mt-1">
                      <strong>Available:</strong> {room.currentAvailability} rooms
                    </p>
                    {room.amenities && (
                      <p className="text-gray-600 text-sm mt-1">
                        <strong>Amenities:</strong> {room.amenities}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        !loading && <p className="text-gray-600">No hotel details found.</p>
      )}
    </div>
  );
}
