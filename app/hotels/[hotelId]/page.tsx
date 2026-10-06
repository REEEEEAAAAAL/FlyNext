"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
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
    <div className="max-w-5xl mx-auto p-8 card">
      {loading && <p className="muted">Loading hotel details...</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
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
          {/* Gallery Section */}
          <div className="mt-8">
            <h2 className="text-2xl font-semibold heading mb-4">Gallery</h2>
            {hotel.images && hotel.images.length > 0 ? (
              <div className="flex space-x-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-400">
                {hotel.images.map((imgUrl, index) => (
                  <div key={index} className="relative w-64 h-48 flex-shrink-0">
                    <Image
                      src={imgUrl}
                      alt={`Image ${index + 1} of ${hotel.name}`}
                      fill
                      className="object-cover rounded shadow-md dark:shadow-none dark:border dark:border-white/10"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 border rounded text-center text-gray-500 dark:border-white/10 dark:text-zinc-400">
                No images available.
              </div>
            )}
          </div>
          {/* Room Types Section */}
          {hotel.roomTypes && hotel.roomTypes.length > 0 && (
            <div className="mt-8">
              <h2 className="text-2xl font-semibold heading mb-4">
                Available Room Types
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {hotel.roomTypes.map((room) => (
                  /*
                   * These room cards are nested inside the page `card`, so they
                   * use the nested-surface primitive (zinc-800 on dark) with the
                   * shared row hover instead of a second full card surface.
                   */
                  <Link
                    key={room.id}
                    href={`/hotels/${hotel.id}/room-types/${room.id}`}
                    className="block p-4 surface row-hover hover:shadow-xl transition duration-300"
                  >
                    <h3 className="text-xl font-bold heading">
                      {room.name}
                    </h3>
                    <p className="muted text-sm mt-1">
                      <strong>Price:</strong> ${room.pricePerNight}/night
                    </p>
                    <p className="muted text-sm mt-1">
                      <strong>Available:</strong> {room.currentAvailability} rooms
                    </p>
                    {room.amenities && (
                      <p className="muted text-sm mt-1">
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
        !loading && <p className="muted">No hotel details found.</p>
      )}
    </div>
  );
}
