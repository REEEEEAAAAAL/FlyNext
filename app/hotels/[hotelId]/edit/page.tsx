"use client";

import { useState, useEffect, FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

interface SelectedImage {
  file: File | null;
  previewUrl: string;
}

interface RoomType {
  id: number;
  name: string;
  amenities: string;
  pricePerNight: number;
  currentAvailability: number;
}

interface HotelFormData {
  name: string;
  logo: string; // logo URL initially
  address: string;
  location: string;
  starRating: number;
  images: string[]; // hotel's images array
}

export default function EditHotelPage() {
  const { hotelId } = useParams();
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
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

  // Form state for hotel details.
  const [formData, setFormData] = useState<HotelFormData>({
    name: "",
    logo: "",
    address: "",
    location: "",
    starRating: 1,
    images: [],
  });

  // For images, we use a separate state with preview functionality.
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // State for room types.
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Fetch the existing hotel details.
  useEffect(() => {
    if (!hotelId) {
      setError("Hotel ID is missing.");
      return;
    }
    const fetchHotelDetails = async () => {
      setLoading(true);
      setError("");
      try {
        const token = localStorage.getItem("accessToken");
        const res = await fetch(`/api/hotels/${hotelId}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to fetch hotel details.");
        } else {
          // API returns { hotel: { ... } }
          const hotelData = data.hotel;
          setFormData({
            name: hotelData.name || "",
            logo: hotelData.logo || "",
            address: hotelData.address || "",
            location: hotelData.location || "",
            starRating: hotelData.starRating || 1,
            images: hotelData.images || [],
          });
          // Set logo preview if available.
          if (hotelData.logo) {
            setLogoPreview(hotelData.logo);
          }
          // Initialize images state from existing image URLs.
          if (hotelData.images && Array.isArray(hotelData.images)) {
            const imagesArr = hotelData.images.map((url: string) => ({
              file: null,
              previewUrl: url,
            }));
            setSelectedImages(imagesArr);
          }
          // Set room types if needed.
          if (hotelData.roomTypes && Array.isArray(hotelData.roomTypes)) {
            setRoomTypes(hotelData.roomTypes);
          }
        }
      } catch (err) {
        setError("An error occurred while fetching hotel details.");
      } finally {
        setLoading(false);
      }
    };

    fetchHotelDetails();
  }, [hotelId]);

  // Handle text input changes.
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "starRating" ? parseInt(value, 10) || 1 : value,
    }));
  };

  // Handle logo file selection.
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  // Handle hotel images selection.
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

  // Remove an image using its previewUrl as a unique key.
  const removeImage = (previewUrl: string) => {
    setSelectedImages((prev) =>
      prev.filter((item) => item.previewUrl !== previewUrl)
    );
  };

  // Handle form submission for updating hotel details.
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
      data.append("address", formData.address);
      data.append("location", formData.location);
      data.append("starRating", formData.starRating.toString());
      // Append logo: if a new logo file is selected, use it; otherwise, send the current logo URL.
      if (logoFile) {
        data.append("logo", logoFile);
      } else {
        data.append("logo", formData.logo);
      }
      // Append hotel images: this will update the hotel's images to exactly match the selectedImages state.
      selectedImages.forEach((item) => {
        if (item.file) {
          data.append("images", item.file);
        } else {
          data.append("images", item.previewUrl);
        }
      });

      const res = await fetch(`/api/hotels/${hotelId}`, {
        method: "PUT",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        body: data,
      });
      const resData = await res.json();
      if (!res.ok) {
        setError(resData.error || "Failed to update hotel.");
      } else {
        setMessage(resData.message || "Hotel updated successfully!");
        // Update the form state with the latest images from the response.
        if (resData.hotel && Array.isArray(resData.hotel.images)) {
          setFormData((prev) => ({
            ...prev,
            images: resData.hotel.images,
          }));
          const updatedImages = resData.hotel.images.map((url: string) => ({
            file: null,
            previewUrl: url,
          }));
          setSelectedImages(updatedImages);
        }
        setTimeout(() => {
          router.push("/hotels/owner");
        }, 1500);
      }
    } catch (err) {
      setError("An error occurred while updating the hotel.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-black shadow-md rounded relative">
      {/* Delete Button */}
      <button
        type="button"
        onClick={async () => {
          if (!confirm("Are you sure you want to delete this hotel?")) return;
          try {
            const token = localStorage.getItem("accessToken");
            const res = await fetch(`/api/hotels/${hotelId}`, {
              method: "DELETE",
              headers: { Authorization: token ? `Bearer ${token}` : "" },
            });
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || "Failed to delete hotel.");
            } else {
              alert(data.message || "Hotel deleted successfully.");
              router.push("/hotels/owner");
            }
          } catch (err) {
            alert("An error occurred while deleting the hotel.");
          }
        }}
        className="absolute top-4 right-4 bg-red-600 text-white rounded-full p-1 hover:bg-red-700"
        title="Delete Hotel"
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

      <h1 className="text-3xl font-bold mb-6 text-gray-800">Edit Hotel</h1>
      {loading ? (
        <p className="text-gray-600">Loading hotel details...</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Logo Preview and Upload */}
          <div className="flex flex-col items-center">
            <div className="relative w-32 h-32 bg-gray-200 rounded-full overflow-hidden mb-3">
              {logoPreview ? (
                <Image
                  src={logoPreview}
                  alt="Logo Preview"
                  fill
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 w-12"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zm-4 7a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
              )}
            </div>
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
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Upload Logo
              <input
                type="file"
                name="logo"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoChange}
                className="hidden"
              />
            </label>
            <p className="text-xs text-gray-500 mt-1">
              Max size: 5MB (JPEG, PNG, WebP)
            </p>
          </div>

          {/* Hotel Name */}
          <div>
            <label className="block text-gray-700 mb-1">Hotel Name:</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="Enter hotel name"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-gray-700 mb-1">Address:</label>
            <input
              type="text"
              name="address"
              value={formData.address}
              onChange={handleChange}
              required
              placeholder="Enter street and zip code"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-gray-700 mb-1">
              Location (City, Country):
            </label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleChange}
              required
              placeholder="e.g., Toronto, ON"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>

          {/* Star Rating */}
          <div>
            <label className="block text-gray-700 mb-1">Star Rating:</label>
            <input
              type="number"
              name="starRating"
              value={formData.starRating}
              onChange={handleChange}
              required
              min="1"
              max="5"
              className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            />
          </div>

          {/* Hotel Images Upload Section */}
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
              Upload Hotel Images
              <input
                type="file"
                name="images"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleImagesChange}
                className="hidden"
              />
            </label>

            {/* Image gallery or default message if none */}
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
                The owner has not provided any images for this hotel.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors"
          >
            {submitting ? "Updating Hotel..." : "Update Hotel"}
          </button>
        </form>
      )}
      {error && <p className="mt-4 text-red-600">{error}</p>}
      {message && <p className="mt-4 text-green-600">{message}</p>}

      {/* Room Types Section */}
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Room Types</h2>
          <Link
            href={`/hotels/${hotelId}/room-types/new`}
            className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors"
          >
            Create New Room Type
          </Link>
        </div>
        {roomTypes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {roomTypes.map((roomType) => (
              <Link
                key={roomType.id}
                href={`/hotels/${hotelId}/room-types/${roomType.id}/edit`}
              >
                <div className="border p-4 rounded hover:shadow-md transition cursor-pointer">
                  <p className="font-semibold">Room Type ID: {roomType.id}</p>
                  <p>Name: {roomType.name}</p>
                  <p>Amenities: {roomType.amenities}</p>
                  <p>Price Per Night: ${roomType.pricePerNight}</p>
                  <p>Availability: {roomType.currentAvailability}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p>No room types found.</p>
        )}
      </div>

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
