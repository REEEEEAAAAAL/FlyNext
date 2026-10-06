"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { clearAccessToken } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

interface SelectedImage {
  file: File | null;
  previewUrl: string;
}

export default function CreateRoomTypePage() {
    const { hotelId } = useParams();
    const router = useRouter();
    const { success, error: toastError, info } = useFeedback();

    // Form state for text fields.
    const [formData, setFormData] = useState({
        name: "",
        amenities: "",
        pricePerNight: "",
        currentAvailability: "",
    });
    // For images.
    const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    // Protect the page
    useEffect(() => {
        const fetchData = async () => {
            const token = localStorage.getItem("accessToken");
            if (!token) {
                // Redirect to login if no token found.
                router.push("/auth/login");
                return;
            }

            const response = await fetch("/api/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.status === 401) {
                // Token expired or invalid - try refreshing
                clearAccessToken();

                // Instead of going directly to login, go to refresh page
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

    // Handle text input changes.
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
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

    // Remove an image.
    const removeImage = (index: number) => {
        setSelectedImages((prev) => {
            const removed = prev[index];
            // Release the preview's blob before dropping it: each picked file mints
            // one object URL and nothing else ever revoked them.
            if (removed && removed.previewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(removed.previewUrl);
            }
            return prev.filter((_, i) => i !== index);
        });
    };

    // Handle form submission.
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        const pending = info("Creating the room type…", { duration: 0 });

        try {
            const token = localStorage.getItem("accessToken");
            if (!token) {
                // Redirect to login if no token found.
                router.push("/auth/login");
                return;
            }

            const response = await fetch("/api/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.status === 401) {
                // Token expired or invalid - try refreshing
                clearAccessToken();

                // Instead of going directly to login, go to refresh page
                router.push("/auth/refresh");
                return;
            }

            const data = new FormData();
            data.append("name", formData.name);
            data.append("amenities", formData.amenities);
            data.append("pricePerNight", formData.pricePerNight);
            data.append("currentAvailability", formData.currentAvailability);

            // Append each selected image.
            selectedImages.forEach((item) => {
                if (item.file) {
                    data.append("images", item.file);
                }
            });

            const res = await fetch(`/api/hotels/${hotelId}/room-types`, {
                method: "POST",
                headers: {
                    Authorization: token ? `Bearer ${token}` : "",
                    // Do not set Content-Type for FormData.
                },
                body: data,
            });
            const resData = await res.json();
            if (!res.ok) {
                const failure = resData.error || "Failed to create room type.";
                setError(failure);
                toastError("Could not create the room type", {
                    description: failure,
                });
            } else {
                success("Room type created", {
                    description:
                        resData.message ||
                        "Its calendar is open for the next 60 nights.",
                });
                setTimeout(() => {
                    router.push(`/hotels/${hotelId}/edit`);
                }, 1500);
            }
        } catch (err) {
            const failure = "An error occurred while creating the room type.";
            setError(failure);
            toastError("Could not create the room type", {
                description: failure,
            });
        } finally {
            pending.dismiss();
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto p-8 card text-black dark:text-zinc-100">
            <h1 className="text-3xl font-bold mb-6 heading">
                Create New Room Type
            </h1>
            {error && (
                <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Room Type Name */}
                <div>
                    <label className="label mb-1">
                        Room Type Name:
                    </label>
                    <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                        placeholder="Enter room type name"
                        className="field"
                    />
                </div>
                {/* Amenities */}
                <div>
                    <label className="label mb-1">
                        Amenities:
                    </label>
                    <input
                        type="text"
                        name="amenities"
                        value={formData.amenities}
                        onChange={handleChange}
                        placeholder="List amenities (comma separated)"
                        className="field"
                    />
                </div>
                {/* Price Per Night */}
                <div>
                    <label className="label mb-1">
                        Price Per Night ($):
                    </label>
                    <input
                        type="number"
                        name="pricePerNight"
                        value={formData.pricePerNight}
                        onChange={handleChange}
                        required
                        /* The API rejects a negative price and requires a finite
                           number, so the constraint is declared on the control
                           instead of surfacing as a 400 after a round trip. */
                        min="0"
                        step="0.01"
                        placeholder="Enter price per night"
                        className="field"
                    />
                </div>
                {/* Current Availability */}
                <div>
                    <label className="label mb-1">
                        Total Availability:
                    </label>
                    <input
                        type="number"
                        name="currentAvailability"
                        value={formData.currentAvailability}
                        onChange={handleChange}
                        required
                        /* Rooms are whole units: the API requires a non-negative
                           integer, so decimals and negatives are refused here. */
                        min="0"
                        step="1"
                        placeholder="Enter current availability"
                        className="field"
                    />
                </div>
                {/* Room Type Images Upload Section */}
                <div className="flex flex-col">
                    <label className="cursor-pointer text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-2">
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
                    {/* Horizontally scrollable gallery */}
                    {selectedImages.length > 0 && (
                        <div className="mt-2 w-full overflow-x-auto">
                            <div className="flex flex-nowrap space-x-4">
                                {selectedImages.map((item, index) => (
                                    <div
                                        /*
                                         * Keyed by the preview URL, not the index:
                                         * with an index key, removing one image made
                                         * React reuse the neighbour's DOM for a
                                         * different item.
                                         */
                                        key={item.previewUrl}
                                        className="relative flex-shrink-0"
                                    >
                                        <img
                                            src={item.previewUrl}
                                            alt={`Image ${index + 1}`}
                                            className="h-32 w-auto object-contain"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeImage(index)}
                                            className="absolute top-0 right-0 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 dark:hover:bg-red-500"
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
                    )}
                </div>
                <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3 bg-black dark:bg-zinc-700 text-white rounded hover:bg-gray-800 dark:hover:bg-zinc-600 transition-colors"
                >
                    {submitting ? "Creating Room Type..." : "Create Room Type"}
                </button>
            </form>
            {/* Back Button */}
            <div className="mt-6 text-center">
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
                >
                    Back
                </button>
            </div>
        </div>
    );
}
