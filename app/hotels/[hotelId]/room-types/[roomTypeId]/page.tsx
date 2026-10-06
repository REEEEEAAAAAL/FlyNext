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
          // Response shape: { roomType: { ... } }
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
    <div className="card max-w-4xl mx-auto p-8 text-black dark:text-zinc-100">
      {loading && <p className="muted">Loading room type details...</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      {roomType && (
        <div>
          <h1 className="text-3xl font-bold mb-4 heading">{roomType.name}</h1>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Amenities:</strong> {roomType.amenities}
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Price Per Night:</strong> ${roomType.pricePerNight}
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Current Availability:</strong> {roomType.currentAvailability}
          </p>
          {roomType.images && roomType.images.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-2xl font-semibold heading mb-3">Gallery</h2>
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
          ) : (
            <p className="text-gray-700 dark:text-zinc-200 mt-6">The owner has not provided any images for this room.</p>
          )}
        </div>
      )}
      {!loading && !error && !roomType && (
        <p className="muted">No room type details found.</p>
      )}
    </div>
  );
}
