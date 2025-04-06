"use client";

import { useState, useEffect, FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

// Register Chart.js components.
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// Define types.
interface AvailabilityRecord {
  id: number;
  date: string; // e.g., "2023-08-15T00:00:00.000Z"
  availability: number;
  roomTypeId: number;
}

interface RoomTypeDetails {
  name: string;
  amenities?: string;
  pricePerNight: number;
  currentAvailability: number;
  images: string[];
}

interface Reservation {
  id: number;
  guestName: string;
  checkIn: string;
  checkOut: string;
  price: number;
  status: string;
}

export default function EditRoomTypePage() {
  const { hotelId, roomTypeId } = useParams() as {
    hotelId: string;
    roomTypeId: string;
  };

  const router = useRouter();

  // Protect the page.
  useEffect(() => {
    const fetchData = async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) {
        router.push("/auth/login");
        return;
      }
      const response = await fetch("/api/user", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        localStorage.removeItem("accessToken");
        router.push("/auth/refresh");
        return;
      }
      const data = await response.json();
      if (data.user.IsHotelOwner === false) {
        router.push("/");
        return;
      }
    };
    fetchData();
  }, [router]);

  // Form state for room type details.
  const [formData, setFormData] = useState<RoomTypeDetails>({
    name: "",
    amenities: "",
    pricePerNight: 0,
    currentAvailability: 0,
    images: [],
  });
  // For images in the form.
  const [selectedImages, setSelectedImages] = useState<
    { file: File | null; previewUrl: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Availability records state.
  const [availabilityRecords, setAvailabilityRecords] = useState<AvailabilityRecord[]>([]);
  // Reservations state.
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // Date range filter states (for availability records).
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  // State for the current month in the calendar view.
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Helper: Format a Date to YYYY-MM-DD.
  const formatDate = (date: Date) => date.toISOString().split("T")[0];

  // Fetch room type details, availability records, and reservations.
  useEffect(() => {
    if (!hotelId || !roomTypeId) {
      setError("Hotel ID or Room Type ID is missing.");
      return;
    }
    const fetchRoomTypeData = async (params = "") => {
      setLoading(true);
      setError("");
      try {
        let url = `/api/hotels/${hotelId}/room-types/${roomTypeId}`;
        if (params) {
          url += `?${params}`;
        }
        const token = localStorage.getItem("accessToken");
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to fetch room type data.");
        } else {
          // Expected response: { roomType: { ... }, availabilityRecords: [...], reservations: [...] }
          if (data.roomType) {
            setFormData({
              name: data.roomType.name || "",
              amenities: data.roomType.amenities || "",
              pricePerNight: data.roomType.pricePerNight || 0,
              currentAvailability: data.roomType.currentAvailability || 0,
              images: data.roomType.images || [],
            });
            if (data.roomType.images && Array.isArray(data.roomType.images)) {
              const imagesArr = data.roomType.images.map((url: string) => ({
                file: null,
                previewUrl: url,
              }));
              setSelectedImages(imagesArr);
            }
          }
          if (data.availabilityRecords) {
            setAvailabilityRecords(data.availabilityRecords);
          }
          if (data.roomType && data.roomType.reservations) {
            setReservations(data.roomType.reservations);
          }
        }
      } catch (err) {
        setError("An error occurred while fetching room type data.");
      } finally {
        setLoading(false);
      }
    };
    fetchRoomTypeData();
  }, [hotelId, roomTypeId]);

  // Handle text input changes.
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === "pricePerNight" || name === "currentAvailability"
          ? Number(value)
          : value,
    }));
  };

  // Handle images selection.
  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setSelectedImages((prev) => [...prev, ...newFiles]);
      e.target.value = "";
    }
  };

  // Remove an image using its previewUrl as key.
  const removeImage = (previewUrl: string) => {
    setSelectedImages((prev) => prev.filter((item) => item.previewUrl !== previewUrl));
  };

  // Handle form submission for updating room type details.
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const token = localStorage.getItem("accessToken");
      if (!token) {
        router.push("/auth/login");
        return;
      }
      const response = await fetch("/api/user", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        localStorage.removeItem("accessToken");
        router.push("/auth/refresh");
        return;
      }
      // Use FormData for file uploads.
      const data = new FormData();
      data.append("name", formData.name);
      data.append("amenities", formData.amenities || "");
      data.append("pricePerNight", formData.pricePerNight.toString());
      data.append("currentAvailability", formData.currentAvailability.toString());
      // Append images from selectedImages.
      selectedImages.forEach((item) => {
        if (item.file) {
          data.append("images", item.file);
        } else {
          data.append("images", item.previewUrl);
        }
      });
      const res = await fetch(
        `/api/hotels/${hotelId}/room-types/${roomTypeId}`,
        {
          method: "PUT",
          headers: { Authorization: token ? `Bearer ${token}` : "" },
          body: data,
        }
      );
      const resData = await res.json();
      if (!res.ok) {
        setError(resData.error || "Failed to update room type.");
      } else {
        setMessage(resData.message || "Room type updated successfully!");
        // Update the form and image state with the latest data from the response.
        if (resData.roomType && Array.isArray(resData.roomType.images)) {
          setFormData((prev) => ({
            ...prev,
            images: resData.roomType.images,
          }));
          const updatedImages = resData.roomType.images.map((url: string) => ({
            file: null,
            previewUrl: url,
          }));
          setSelectedImages(updatedImages);
        }
        setTimeout(() => {
          router.push(`/hotels/${hotelId}/edit`);
        }, 1500);
      }
    } catch (err) {
      setError("An error occurred while updating the room type.");
    } finally {
      setSubmitting(false);
    }
  };

  // The rest of your component (availability records, calendar view, reservations, etc.) remains unchanged.

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-black shadow-md rounded relative">
      {/* Delete Room Type Button */}
      <button
        type="button"
        onClick={async () => {
          if (!confirm("Are you sure you want to delete this room type?"))
            return;
          try {
            const token = localStorage.getItem("accessToken");
            const res = await fetch(
              `/api/hotels/${hotelId}/room-types/${roomTypeId}`,
              {
                method: "DELETE",
                headers: { Authorization: token ? `Bearer ${token}` : "" },
              }
            );
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || "Failed to delete room type.");
            } else {
              alert(data.message || "Room type deleted successfully.");
              router.push(`/hotels/${hotelId}/edit`);
            }
          } catch (err) {
            alert("An error occurred while deleting the room type.");
          }
        }}
        className="absolute top-4 right-4 bg-red-600 text-white rounded-full p-1 hover:bg-red-700"
        title="Delete Room Type"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5-4h4a1 1 0 011 1v2H9V4a1 1 0 011-1z"
          />
        </svg>
      </button>

      <h1 className="text-3xl font-bold mb-6 text-gray-800">Edit Room Type</h1>
      {loading ? (
        <p className="text-gray-600">Loading room type details...</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Room Type Details Form */}
          <div>
            <label className="block text-gray-700 mb-1">Room Type Name:</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="Enter room type name"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-1">Amenities:</label>
            <input
              type="text"
              name="amenities"
              value={formData.amenities || ""}
              onChange={handleChange}
              placeholder="List amenities (comma separated)"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-1">Price Per Night ($):</label>
            <input
              type="number"
              name="pricePerNight"
              value={formData.pricePerNight}
              onChange={handleChange}
              required
              placeholder="Enter price per night"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-1">Total Availability:</label>
            <input
              type="number"
              name="currentAvailability"
              value={formData.currentAvailability}
              onChange={handleChange}
              required
              placeholder="Enter current availability"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>

          {/* Room Type Images Upload Section */}
          <div className="flex flex-col">
            <label className="cursor-pointer text-blue-600 hover:text-blue-800 flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v4h16v-4M12 12v8m-4-4h8m-9-9h10M12 4v4"
                />
              </svg>
              Upload Room Type Images
              <input
                type="file"
                name="images"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleImagesChange}
                className="hidden"
              />
            </label>
            {/* Display image gallery or a default message if none */}
            {selectedImages.length > 0 ? (
              <div className="mt-2 w-full overflow-x-scroll">
                <div className="flex flex-nowrap space-x-4">
                  {selectedImages.map((item) => (
                    <div key={item.previewUrl} className="relative flex-shrink-0">
                      <img
                        src={item.previewUrl}
                        alt={`Image of ${formData.name}`}
                        className="h-32 w-auto object-contain"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(item.previewUrl)}
                        className="absolute top-0 right-0 bg-red-600 text-white rounded-full p-1 hover:bg-red-700"
                        title="Remove image"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-gray-700 mt-2">
                The owner has not provided any images for this room.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors"
          >
            {submitting ? "Updating Room Type..." : "Update Room Type"}
          </button>
        </form>
      )}
      {error && <p className="mt-4 text-red-600">{error}</p>}
      {message && <p className="mt-4 text-green-600">{message}</p>}

      {/* The rest of your component for availability records, calendar, reservations, etc. */}
      {/* ... */}
      
      {/* Back Button */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Back
        </button>
      </div>
    </div>
  );
}
