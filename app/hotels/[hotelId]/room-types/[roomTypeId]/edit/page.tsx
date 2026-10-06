"use client";

import { useState, useEffect, FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useFeedback } from "@/app/context/FeedbackContext";
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
import { useTheme } from "@/app/context/ThemeContext";
import { clearAccessToken } from "@/app/lib/session";

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

/**
 * Formats an `R G B / A` design token as the `rgba()` string Chart.js requires.
 *
 * The alpha is optional: `"229 231 235"` and `"255 255 255 / 0.08"` are both
 * valid. The channels have to be split individually — `parseInt` on
 * `"229 231 235 "` would stop at the first space and yield only `229`.
 */
function formatChartRgb(token: string, fallback: string): string {
  const [channels, alphaPart] = token.split("/");
  const [r, g, b] = channels.trim().split(/\s+/).map((part) => Number(part));
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return fallback;
  }
  const alpha = alphaPart === undefined ? 1 : Number(alphaPart);
  return `rgba(${r}, ${g}, ${b}, ${Number.isFinite(alpha) ? alpha : 1})`;
}

/**
 * Resolves the `--chart-*` design tokens from `app/globals.css` into the
 * concrete colours Chart.js needs.
 *
 * Chart.js paints into a `<canvas>`, so `dark:` utilities cannot reach the grid
 * lines, tick labels, legend or tooltip — they are configured from JavaScript.
 * Reading the same tokens the rest of the theme uses keeps the chart in step
 * with the `.dark` class instead of the OS preference, which is what matters
 * here because the user can override the system setting.
 *
 * Tokens must keep the `R G B / A` shape declared in `globals.css`.
 */
function readChartColors() {
  const light = {
    grid: "rgba(229, 231, 235, 1)",
    tick: "rgba(75, 85, 99, 1)",
    title: "rgba(17, 24, 39, 1)",
    legend: "rgba(55, 65, 81, 1)",
    line: "rgba(13, 148, 136, 1)",
    tooltipBg: "rgba(255, 255, 255, 0.98)",
    tooltipTitle: "rgba(17, 24, 39, 1)",
    tooltipBody: "rgba(55, 65, 81, 1)",
    tooltipBorder: "rgba(229, 231, 235, 1)",
  };

  // Server render and the first client render have no document yet, and an
  // unstyled chart would be rendered on the server anyway.
  if (typeof window === "undefined") {
    return light;
  }

  const styles = window.getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value ? formatChartRgb(value, fallback) : fallback;
  };

  return {
    grid: token("--chart-grid", light.grid),
    tick: token("--chart-tick", light.tick),
    title: token("--chart-title", light.title),
    legend: token("--chart-legend", light.legend),
    line: token("--chart-line", light.line),
    tooltipBg: token("--chart-tooltip-bg", light.tooltipBg),
    tooltipTitle: token("--chart-tooltip-title", light.tooltipTitle),
    tooltipBody: token("--chart-tooltip-body", light.tooltipBody),
    tooltipBorder: token("--chart-tooltip-border", light.tooltipBorder),
  };
}

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

    /*
     * Chart colours are resolved from the `--chart-*` tokens at render time, so
     * the chart has to be re-rendered when the theme changes. Subscribing to the
     * context is what makes the axis labels, grid and tooltip repaint on toggle;
     * without it the canvas would keep the previous theme's colours until an
     * unrelated state change happened to re-render the page.
     */
    const { resolvedTheme } = useTheme();

    /*
     * Feedback for every action on this page: a successful cancellation and a
     * failed one are told apart by their toast variant, not by where on the page
     * they appear, so the two cannot be confused for each other.
     */
    const { confirm, success, error: toastError, info } = useFeedback();

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
                clearAccessToken();
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

    // Availability records state.
    const [availabilityRecords, setAvailabilityRecords] = useState<
        AvailabilityRecord[]
    >([]);
    // Reservations state.
    const [reservations, setReservations] = useState<Reservation[]>([]);
    // Date range filter states (for availability records).
    const [checkIn, setCheckIn] = useState("");
    const [checkOut, setCheckOut] = useState("");

    // State for the current month in the calendar view.
    const [currentMonth, setCurrentMonth] = useState(new Date());

    /*
     * Theme-aware Chart.js palette.
     *
     * `resolvedTheme` is read first: it is the dependency that makes this value
     * change when the user toggles the theme, which is what forces the canvas to
     * repaint with the new axis, grid and tooltip colours.
     */
    const chartColors = (() => {
        void resolvedTheme;
        return readChartColors();
    })();

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
                            currentAvailability:
                                data.roomType.currentAvailability || 0,
                            images: data.roomType.images || [],
                        });
                        if (
                            data.roomType.images &&
                            Array.isArray(data.roomType.images)
                        ) {
                            const imagesArr = data.roomType.images.map(
                                (url: string) => ({
                                    file: null,
                                    previewUrl: url,
                                })
                            );
                            setSelectedImages(imagesArr);
                        }
                    }
                    if (data.availabilityRecords) {
                        setAvailabilityRecords(data.availabilityRecords ?? []);
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
        setSelectedImages((prev) =>
            prev.filter((item) => item.previewUrl !== previewUrl)
        );
    };

    // Handle form submission for updating room type details.
    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError("");
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
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }
            // Use FormData for file uploads.
            const data = new FormData();
            data.append("name", formData.name);
            data.append("amenities", formData.amenities || "");
            data.append("pricePerNight", formData.pricePerNight.toString());
            data.append(
                "currentAvailability",
                formData.currentAvailability.toString()
            );
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
                const failure = resData.error || "Failed to update room type.";
                setError(failure);
                toastError("Could not update the room type", {
                    description: failure,
                });
            } else {
                success("Room type updated", {
                    description:
                        resData.message || "Your changes have been saved.",
                });
                // Update the form and image state with the latest data from the response.
                if (
                    resData.roomType &&
                    Array.isArray(resData.roomType.images)
                ) {
                    setFormData((prev) => ({
                        ...prev,
                        images: resData.roomType.images,
                    }));
                    const updatedImages = resData.roomType.images.map(
                        (url: string) => ({
                            file: null,
                            previewUrl: url,
                        })
                    );
                    setSelectedImages(updatedImages);
                }
                setTimeout(() => {
                    router.push(`/hotels/${hotelId}/edit`);
                }, 1500);
            }
        } catch (err) {
            const failure = "An error occurred while updating the room type.";
            setError(failure);
            toastError("Could not update the room type", {
                description: failure,
            });
        } finally {
            setSubmitting(false);
        }
    };

    // Handle availability filter submission.
    const handleAvailabilityFilter = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const params = new URLSearchParams();
        if (checkIn && checkOut) {
            params.append("checkIn", checkIn);
            params.append("checkOut", checkOut);
        }
        try {
            const token = localStorage.getItem("accessToken");
            let url = `/api/hotels/${hotelId}/room-types/${roomTypeId}`;
            if (params.toString()) {
                url += `?${params.toString()}`;
            }
            const res = await fetch(url, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: token ? `Bearer ${token}` : "",
                },
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || "Failed to fetch availability records.");
            } else {
                setAvailabilityRecords(data.availabilityRecords ?? []);
            }
        } catch (err) {
            setError("An error occurred while fetching availability records.");
        }
    };

    /**
     * Cancel a guest's reservation, after a full-screen confirmation.
     *
     * The owner is cancelling somebody else's booking, which is the one action on
     * this page with consequences for a third party, so the dialog names it: the
     * guest is notified and the nights go back on sale for everyone.
     */
    const handleCancelReservation = async (reservationId: number | null) => {
        const confirmed = await confirm({
            title: "Cancel this reservation?",
            description:
                "The guest's booking for this room type will be cancelled and every night of the stay released. This cannot be undone.",
            points: [
                "The guest is notified that the hotel cancelled their booking.",
                "The nights return to your availability calendar and can be sold again.",
                "If the stay is on an itinerary, that itinerary's total is reduced.",
            ],
            confirmLabel: "Yes, cancel reservation",
            cancelLabel: "Keep reservation",
        });
        if (!confirmed) return;

        const pending = info("Cancelling the reservation…", { duration: 0 });
        try {
            const token = localStorage.getItem("accessToken");
            const res = await fetch(
                `/api/hotels/book?reservationId=${reservationId}`,
                {
                    method: "DELETE",
                    headers: { Authorization: token ? `Bearer ${token}` : "" },
                }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toastError("Could not cancel the reservation", {
                    description: data?.error || "Failed to cancel reservation.",
                });
                return;
            }

            success("Reservation cancelled", {
                description:
                    data?.message ||
                    "The stay has been cancelled and the nights released.",
            });

            /*
             * Re-read the room type so the reservations list reflects the
             * cancellation. The same response also carries the recomputed
             * `availabilityRecords`, and cancelling a reservation increments
             * the availability of every night it held (see
             * `cancelHotelReservation` in `lib/reservations.ts`). That half is
             * what the chart and the calendar render, so without it they keep
             * showing the nights as still sold and the owner cannot see the rooms
             * come back.
             */
            const refreshed = await fetch(
                `/api/hotels/${hotelId}/room-types/${roomTypeId}`,
                {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: token ? `Bearer ${token}` : "",
                    },
                }
            );
            if (!refreshed.ok) {
                // The cancellation itself succeeded; only the refresh failed.
                const failure =
                    "The reservation was cancelled, but the availability calendar could not be refreshed. Reload the page.";
                setError(failure);
                toastError("Calendar out of date", { description: failure });
                return;
            }
            const data2 = await refreshed.json();
            if (data2.roomType && data2.roomType.reservations) {
                setReservations(data2.roomType.reservations);
            }
            if (Array.isArray(data2.availabilityRecords)) {
                setAvailabilityRecords(data2.availabilityRecords);
            }
        } catch (err) {
            toastError("Could not cancel the reservation", {
                description:
                    "An error occurred while cancelling the reservation.",
            });
        } finally {
            pending.dismiss();
        }
    };

    /**
     * Delete the room type, after a full-screen confirmation.
     *
     * Distinct from cancelling a reservation: this removes the room type itself,
     * so the dialog has to say that the calendar goes with it and that the link
     * the guest holds stops resolving.
     */
    const handleDeleteRoomType = async () => {
        const confirmed = await confirm({
            title: "Delete this room type?",
            description:
                "The room type and its entire availability calendar are removed from this hotel. This cannot be undone.",
            points: [
                "Its remaining reservations keep their history but lose the room type.",
                "Guests can no longer book this room type on any date.",
                "The price and availability settings are lost with it.",
            ],
            confirmLabel: "Yes, delete room type",
            cancelLabel: "Keep room type",
        });
        if (!confirmed) return;

        const pending = info("Deleting the room type…", { duration: 0 });
        try {
            const token = localStorage.getItem("accessToken");
            const res = await fetch(
                `/api/hotels/${hotelId}/room-types/${roomTypeId}`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: token ? `Bearer ${token}` : "",
                    },
                }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toastError("Could not delete the room type", {
                    description: data?.error || "Failed to delete room type.",
                });
            } else {
                success("Room type deleted", {
                    description:
                        data?.message || "The room type has been removed.",
                });
                router.push(`/hotels/${hotelId}/edit`);
            }
        } catch (err) {
            toastError("Could not delete the room type", {
                description: "An error occurred while deleting the room type.",
            });
        } finally {
            pending.dismiss();
        }
    };

    // Calendar-like view: Month-by-month view with year navigation.
    const formatMonthYear = (date: Date) =>
        date.toLocaleString("default", { month: "long", year: "numeric" });

    // Get the start and end of the current month.
    const startOfMonth = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        1
    );
    const endOfMonth = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() + 1,
        0
    );

    // Generate days for the current month.
    const monthDays = [];
    for (
        let d = new Date(startOfMonth);
        d <= endOfMonth;
        d.setDate(d.getDate() + 1)
    ) {
        monthDays.push(new Date(d));
    }

    return (
        <div className="max-w-3xl mx-auto p-8 card text-black dark:text-zinc-100 relative">
            {/* Delete Room Type Button */}
            <button
                type="button"
                onClick={handleDeleteRoomType}
                className="absolute top-4 right-4 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 dark:hover:bg-red-500"
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

            <h1 className="text-3xl font-bold mb-6 heading">
                Edit Room Type
            </h1>
            {loading ? (
                <p className="text-gray-600 dark:text-zinc-400">
                    Loading room type details...
                </p>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Room Type Details Form */}
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
                    <div>
                        <label className="label mb-1">
                            Amenities:
                        </label>
                        <input
                            type="text"
                            name="amenities"
                            value={formData.amenities || ""}
                            onChange={handleChange}
                            placeholder="List amenities (comma separated)"
                            className="field"
                        />
                    </div>
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
                            /* Declared on the control so a negative price is refused
                               here rather than by the API after a round trip. */
                            min="0"
                            step="0.01"
                            placeholder="Enter price per night"
                            className="field"
                        />
                    </div>
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
                            /* Whole rooms only: the API requires a non-negative
                               integer and would answer 400 for a decimal. */
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
                        {/* Display image gallery or a default message if none */}
                        {selectedImages.length > 0 ? (
                            <div className="mt-2 w-full overflow-x-scroll">
                                <div className="flex flex-nowrap space-x-4">
                                    {selectedImages.map((item) => (
                                        <div
                                            key={item.previewUrl}
                                            className="relative flex-shrink-0"
                                        >
                                            <img
                                                src={item.previewUrl}
                                                alt={`Image of ${formData.name}`}
                                                className="h-32 w-auto object-contain"
                                            />
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    removeImage(item.previewUrl)
                                                }
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
                        ) : (
                            <p className="text-gray-700 dark:text-zinc-200 mt-2">
                                The owner has not provided any images for this
                                room.
                            </p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-3 bg-black dark:bg-zinc-700 text-white rounded hover:bg-gray-800 dark:hover:bg-zinc-600 transition-colors"
                    >
                        {submitting
                            ? "Updating Room Type..."
                            : "Update Room Type"}
                    </button>
                </form>
            )}
            {error && (
                <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>
            )}

            {/* Availability Records Section */}
            <div className="mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold heading">
                        Availability Records
                    </h2>
                    <form
                        onSubmit={handleAvailabilityFilter}
                        className="flex flex-wrap items-center gap-4"
                    >
                        <div>
                            <label className="label mb-1">
                                Check-In:
                            </label>
                            <input
                                type="date"
                                value={checkIn}
                                onChange={(e) => setCheckIn(e.target.value)}
                                className="border p-2 rounded dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100"
                            />
                        </div>
                        <div>
                            <label className="label mb-1">
                                Check-Out:
                            </label>
                            <input
                                type="date"
                                value={checkOut}
                                onChange={(e) => setCheckOut(e.target.value)}
                                className="border p-2 rounded dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100"
                            />
                        </div>
                        <button
                            type="submit"
                            className="bg-black dark:bg-zinc-700 text-white px-4 py-2 rounded hover:bg-gray-800 dark:hover:bg-zinc-600 transition-colors"
                        >
                            Filter
                        </button>
                    </form>
                </div>

                {loading && <p>Loading availability records...</p>}
                {availabilityRecords.length === 0 && !loading && (
                    <p>No availability records found.</p>
                )}
                {availabilityRecords.length > 0 && (
                    <div className="mt-4">
                        <Line
                            data={{
                                labels: availabilityRecords.map((record) =>
                                    new Date(record.date).toLocaleDateString()
                                ),
                                datasets: [
                                    {
                                        label: "Availability",
                                        data: availabilityRecords.map(
                                            (record) => record.availability
                                        ),
                                        fill: false,
                                        borderColor: chartColors.line,
                                        pointBackgroundColor: chartColors.line,
                                        pointBorderColor: chartColors.line,
                                        tension: 0.1,
                                    },
                                ],
                            }}
                            options={{
                                responsive: true,
                                /*
                                 * Chart.js paints into a <canvas>, so none of
                                 * this can be a Tailwind class: without an
                                 * explicit colour the grid and ticks fall back
                                 * to a dark grey that is invisible on the dark
                                 * canvas.
                                 */
                                color: chartColors.tick,
                                plugins: {
                                    legend: {
                                        labels: { color: chartColors.legend },
                                    },
                                    title: {
                                        display: false,
                                        color: chartColors.title,
                                    },
                                    tooltip: {
                                        backgroundColor: chartColors.tooltipBg,
                                        titleColor: chartColors.tooltipTitle,
                                        bodyColor: chartColors.tooltipBody,
                                        borderColor: chartColors.tooltipBorder,
                                        borderWidth: 1,
                                        displayColors: false,
                                    },
                                },
                                scales: {
                                    x: {
                                        grid: { color: chartColors.grid },
                                        border: { color: chartColors.grid },
                                        ticks: { color: chartColors.tick },
                                    },
                                    y: {
                                        beginAtZero: true,
                                        grid: { color: chartColors.grid },
                                        border: { color: chartColors.grid },
                                        ticks: {
                                            stepSize: 1,
                                            color: chartColors.tick,
                                        },
                                    },
                                },
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Month-by-Month Calendar View with Year Navigation */}
            <div className="mt-8">
                <h2 className="text-2xl font-bold mb-4 heading">
                    Booking Calendar
                </h2>
                <div className="flex justify-between items-center mb-2">
                    <button
                        className="px-2 py-1 bg-gray-300 rounded dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                        onClick={() =>
                            setCurrentMonth(
                                new Date(
                                    currentMonth.getFullYear() - 1,
                                    currentMonth.getMonth(),
                                    1
                                )
                            )
                        }
                    >
                        Prev Year
                    </button>
                    <button
                        className="px-2 py-1 bg-gray-300 rounded dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                        onClick={() =>
                            setCurrentMonth(
                                new Date(
                                    currentMonth.getFullYear(),
                                    currentMonth.getMonth() - 1,
                                    1
                                )
                            )
                        }
                    >
                        Prev Month
                    </button>
                    <div className="font-semibold">
                        {currentMonth.toLocaleString("default", {
                            month: "long",
                            year: "numeric",
                        })}
                    </div>
                    <button
                        className="px-2 py-1 bg-gray-300 rounded dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                        onClick={() =>
                            setCurrentMonth(
                                new Date(
                                    currentMonth.getFullYear(),
                                    currentMonth.getMonth() + 1,
                                    1
                                )
                            )
                        }
                    >
                        Next Month
                    </button>
                    <button
                        className="px-2 py-1 bg-gray-300 rounded dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                        onClick={() =>
                            setCurrentMonth(
                                new Date(
                                    currentMonth.getFullYear() + 1,
                                    currentMonth.getMonth(),
                                    1
                                )
                            )
                        }
                    >
                        Next Year
                    </button>
                </div>
                <div className="grid grid-cols-7 gap-2">
                    {/* Render day headers */}
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (d, idx) => (
                            <div key={idx} className="font-bold text-center">
                                {d}
                            </div>
                        )
                    )}
                    {(() => {
                        // Determine first day index and number of days in current month.
                        const firstDayOfMonth = new Date(
                            currentMonth.getFullYear(),
                            currentMonth.getMonth(),
                            1
                        );
                        const startIndex = firstDayOfMonth.getDay();
                        const endOfMonth = new Date(
                            currentMonth.getFullYear(),
                            currentMonth.getMonth() + 1,
                            0
                        );
                        const daysInMonth = endOfMonth.getDate();

                        const cells = [];

                        // Add blank cells for days before the first day of the month.
                        for (let i = 0; i < startIndex; i++) {
                            cells.push(<div key={`blank-${i}`} />);
                        }
                        // Add day cells.
                        for (let day = 1; day <= daysInMonth; day++) {
                            const d = new Date(
                                currentMonth.getFullYear(),
                                currentMonth.getMonth(),
                                day
                            );
                            const formatted = formatDate(d);
                            const record = availabilityRecords.find(
                                (r) =>
                                    formatDate(new Date(r.date)) === formatted
                            );
                            cells.push(
                                <div
                                    key={day}
                                    className={`p-2 border rounded text-center dark:border-white/15 ${
                                        record
                                            ? "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-500/20"
                                            : "bg-gray-200 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400 cursor-not-allowed"
                                    }`}
                                    onClick={() => {
                                        if (record) {
                                            /*
                                             * An informational pill rather than
                                             * `alert()`: this fires on every
                                             * click of a calendar cell, and a
                                             * blocking dialog for a
                                             * two-value readout made browsing
                                             * the calendar tedious.
                                             */
                                            info(formatted, {
                                                description: `${record.availability} of ${formData.currentAvailability} rooms available`,
                                                duration: 3000,
                                            });
                                        }
                                    }}
                                >
                                    <div className="font-semibold">{day}</div>
                                    {record ? (
                                        <div className="text-xs">
                                            {record.availability} available
                                        </div>
                                    ) : (
                                        <div className="text-xs">No record</div>
                                    )}
                                </div>
                            );
                        }
                        return cells;
                    })()}
                </div>
            </div>

            {/* Reservations Section */}
            <div className="mt-8">
                <h2 className="text-2xl font-bold mb-4 heading">Reservations</h2>
                {reservations.length === 0 && (
                    <p>No reservations found for this room type.</p>
                )}
                {reservations.map((resv) => {
                    const cancelReservationId = resv.id;
                    return (
                        <div
                            key={resv.id}
                            className="surface p-4 mb-4 flex flex-col md:flex-row justify-between items-start md:items-center"
                        >
                            <div>
                                <p className="font-semibold">
                                    Reservation ID: {resv.id}
                                </p>
                                <p>
                                    <strong>Guest:</strong> {resv.guestName}
                                </p>
                                <p>
                                    <strong>Check-In:</strong>{" "}
                                    {new Date(
                                        resv.checkIn
                                    ).toLocaleDateString()}
                                </p>
                                <p>
                                    <strong>Check-Out:</strong>{" "}
                                    {new Date(
                                        resv.checkOut
                                    ).toLocaleDateString()}
                                </p>
                                <p>
                                    <strong>Price:</strong> ${resv.price}
                                </p>
                                <p>
                                    <strong>Status:</strong> {resv.status}
                                </p>
                            </div>
                            {resv.status !== "CANCELLED" && (
                                <button
                                    onClick={() =>
                                        handleCancelReservation(
                                            cancelReservationId
                                        )
                                    }
                                    className="mt-4 md:mt-0 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 dark:hover:bg-red-500 transition-colors"
                                >
                                    Cancel Reservation
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

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
