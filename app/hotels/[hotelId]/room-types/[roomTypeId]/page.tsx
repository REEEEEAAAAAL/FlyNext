"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface RoomType {
  id: number;
  name: string;
  amenities: string;
  pricePerNight: number;
  currentAvailability: number;
  images: string[];
}

export default function RoomTypeDetailsPage() {
  const { hotelId, roomTypeId } = useParams() as { hotelId: string; roomTypeId: string };
  const [roomType, setRoomType] = useState<RoomType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hotelId || !roomTypeId) return;
    const fetchRoomTypeDetails = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/hotels/${hotelId}/room-types/${roomTypeId}`, {
          method: "GET",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Error fetching room type details.");
        } else {
          // Expecting the response to be: { roomType: { ... } }
          setRoomType(data.roomType);
        }
      } catch (err) {
        setError("An error occurred while fetching room type details.");
      } finally {
        setLoading(false);
      }
    };
    fetchRoomTypeDetails();
  }, [hotelId, roomTypeId]);

  return (
    <div className="max-w-4xl mx-auto p-8 bg-white text-black shadow-md rounded">
      {loading && <p className="text-gray-600">Loading room type details...</p>}
      {error && <p className="text-red-600">{error}</p>}
      {roomType && (
        <div>
          <h1 className="text-3xl font-bold mb-4 text-gray-800">{roomType.name}</h1>
          <p className="text-gray-700 mb-2">
            <strong>Amenities:</strong> {roomType.amenities}
          </p>
          <p className="text-gray-700 mb-2">
            <strong>Price Per Night:</strong> ${roomType.pricePerNight}
          </p>
          <p className="text-gray-700 mb-2">
            <strong>Current Availability:</strong> {roomType.currentAvailability}
          </p>
          {roomType.images && roomType.images.length > 0 && (
            <div className="mt-6">
              <h2 className="text-2xl font-semibold text-gray-800 mb-3">Gallery</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {roomType.images.map((imgUrl, index) => (
                  <img
                    key={index}
                    src={imgUrl}
                    alt={`Image ${index + 1} of ${roomType.name}`}
                    className="w-full h-48 object-cover rounded"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!loading && !error && !roomType && (
        <p className="text-gray-600">No room type details found.</p>
      )}
    </div>
  );
}