"use client";

import HotelStayPicker from "@/app/components/HotelStayPicker";
import ImageGallery from "@/app/components/ImageGallery";

import { sessionFetch } from "@/app/lib/session";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hotelId || !roomTypeId) return;
    const fetchRoomTypeDetails = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await sessionFetch(`/api/hotels/${hotelId}/room-types/${roomTypeId}`, {
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
      {loading && <p role="status" className="muted">Loading room type details...</p>}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      {roomType && (
        <div>
          <h1 className="text-3xl font-bold mb-4 heading">{roomType.name}</h1>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Amenities:</strong> {roomType.amenities}
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Price Per Night:</strong> ${roomType.pricePerNight.toFixed(2)} USD
          </p>
          <p className="text-gray-700 dark:text-zinc-200 mb-2">
            <strong>Configured capacity:</strong> {roomType.currentAvailability}. Search with stay dates for availability.
          </p>
          <div className="mt-6"><ImageGallery images={roomType.images ?? []} name={roomType.name} /></div>
          <HotelStayPicker hotelId={hotelId} rooms={[roomType]} roomDetail />
        </div>
      )}
      {!loading && !error && !roomType && (
        <p className="muted">No room type details found.</p>
      )}
    </div>
  );
}
