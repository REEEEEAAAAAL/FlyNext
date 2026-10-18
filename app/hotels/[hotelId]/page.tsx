"use client";

import HotelStayPicker from "@/app/components/HotelStayPicker";
import ImageGallery from "@/app/components/ImageGallery";

import { sessionFetch } from "@/app/lib/session";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";

/*
 * A room type as `GET /api/hotels/[hotelId]` actually returns it — see
 * `RoomTypeSummary`. There is no `description` and no `capacity` column on the
 * model, so declaring them here would render an empty line and "Capacity: people"
 * on every room card.
 */
interface RoomType {
  id: number;
  name: string;
  pricePerNight: number;
  currentAvailability: number;
  amenities: string | null;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hotelId) return;
    const fetchHotelDetails = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await sessionFetch(`/api/hotels/${hotelId}`, { method: "GET" });
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
    <div className="max-w-5xl mx-auto p-8 card">
      {loading && <p role="status" className="muted">Loading hotel details...</p>}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
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
              <h1 className="text-4xl font-bold heading">{hotel.name}</h1>
              <p className="mt-2 muted">
                <strong>Address:</strong> {hotel.address}
              </p>
              <p className="mt-1 muted">
                <strong>Location:</strong> {hotel.location}
              </p>
              <p className="mt-1 muted">
                <strong>Star Rating:</strong>{" "}
                <span className="text-yellow-500 dark:text-yellow-400">{renderStars(hotel.starRating)}</span>
              </p>
            </div>
          </div>
          <a className="button-primary mt-6" href="#stay-dates">Choose stay dates</a>
          {/* Gallery Section */}
          <div className="mt-8">
            <h2 className="text-2xl font-semibold heading mb-4">Gallery</h2>
            <ImageGallery images={hotel.images ?? []} name={hotel.name} />
          </div>
          <HotelStayPicker hotelId={String(hotelId)} rooms={hotel.roomTypes ?? []} />
        </>
      ) : (
        !loading && <p className="muted">No hotel details found.</p>
      )}
    </div>
  );
}
