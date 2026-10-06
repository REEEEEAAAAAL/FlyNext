"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearAccessToken } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

interface SelectedImage {
  file: File;
  previewUrl: string;
}

export default function CreateHotelPage() {
  const router = useRouter();
  const { success, error: toastError, info } = useFeedback();

  // Form state for text inputs.
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    location: "",
    starRating: 1,
  });

  // State for logo file and its preview URL.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // State for selected hotel images.
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Protect the page: if no access token is found, redirect to login.
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
    };

    fetchData();
  }, [router]);

  // Handle text input changes.
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "starRating" ? parseInt(value, 10) || 1 : value,
    }));
  };

  // Handle the logo file selection and create a preview URL.
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  // Handle multiple hotel images selection.
  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      // Append the new files to the images already selected.
      setSelectedImages((prev) => [...prev, ...newFiles]);
      // Reset the input so the same file can be picked again.
      e.target.value = "";
    }
  };

  // Remove a selected image.
  const removeImage = (index: number) => {
    setSelectedImages((prev) => {
      const removed = prev[index];
      /*
       * Release the preview's blob before dropping it. Each picked file mints one
       * object URL and nothing else ever revoked them, so a form used a few times
       * pinned every image the user had selected for the life of the document.
       * Only `blob:` URLs are revoked — an entry that came back from the server is
       * a plain path.
       */
      if (removed && removed.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // Handle form submission for creating a hotel.
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const pending = info("Creating your hotel…", { duration: 0 });

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

      // Build a FormData object for multipart/form-data submission.
      const data = new FormData();
      data.append("name", formData.name);
      data.append("address", formData.address);
      data.append("location", formData.location);
      data.append("starRating", formData.starRating.toString());

      // Append the logo file if selected.
      if (logoFile) {
        data.append("logo", logoFile);
      }

      // Append each selected hotel image.
      selectedImages.forEach((item) => {
        data.append("images", item.file);
      });

      const res = await fetch("/api/hotels", {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          // Do not set Content-Type header for FormData.
        },
        body: data,
      });

      const result = await res.json();
      if (!res.ok) {
        const failure = result.error || "Failed to create hotel.";
        setError(failure);
        toastError("Could not create the hotel", { description: failure });
      } else {
        success("Hotel created", {
          description:
            result.message ||
            "Your listing is live. Add room types to start taking bookings.",
        });
        // Automatically redirect to the owner page after creation.
        router.push("/hotels/owner");
      }
    } catch (err) {
      const failure = "An error occurred while creating the hotel.";
      setError(failure);
      toastError("Could not create the hotel", { description: failure });
    } finally {
      pending.dismiss();
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8 card text-black dark:text-zinc-100">
      <h1 className="text-3xl font-bold mb-6 heading text-center">
        Add a New Hotel
      </h1>

      {error && (
        <p className="text-red-600 dark:text-red-400 mb-4 text-center">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Hotel Logo Upload Section */}
        <div className="flex flex-col items-center">
          <div className="relative w-32 h-32 bg-gray-200 dark:bg-zinc-800 dark:ring-1 dark:ring-white/15 rounded-full overflow-hidden mb-3">
            {logoPreview ? (
              /*
               * A plain `img`, not `next/image`: the source is a `blob:` URL for
               * the file the user just picked, and those are not addressable from
               * the image optimizer, so `next/image` would render an empty box.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
                alt="Hotel Logo Preview"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-zinc-500">
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
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
            Max size: 5MB (JPEG, PNG, WebP)
          </p>
        </div>

        {/* Hotel Name */}
        <div>
          <label className="label mb-1">Hotel Name:</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            placeholder="Enter hotel name"
            className="field"
          />
        </div>

        {/* Address */}
        <div>
          <label className="label mb-1">Address:</label>
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
            required
            placeholder="Enter street and zip code"
            className="field"
          />
        </div>

        {/* Location */}
        <div>
          <label className="label mb-1">
            Location (City, Country):
          </label>
          <input
            type="text"
            name="location"
            value={formData.location}
            onChange={handleChange}
            required
            placeholder="e.g., Toronto, ON"
            className="field"
          />
        </div>

        {/* Star Rating */}
        <div>
          <label className="label mb-1">Star Rating:</label>
          <input
            type="number"
            name="starRating"
            value={formData.starRating}
            onChange={handleChange}
            required
            min="1"
            max="5"
            className="field"
          />
        </div>

        {/* Hotel Images Upload Section with Button */}
        <div className="flex flex-col items-center">
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

          {/* Display list of selected images with preview URLs and remove option */}
          {selectedImages.length > 0 && (
            <div className="mt-2 w-full">
              <ul className="list-disc list-inside text-xs text-gray-500 dark:text-zinc-400 space-y-1">
                {selectedImages.map((item, index) => (
                  /*
                   * Keyed by the preview URL, not the index. With `key={index}`,
                   * removing the first of two images made React reuse the remaining
                   * row's DOM while re-pointing it at the second item, so the listed
                   * filename could disagree with what the × button would remove.
                   */
                  <li
                    key={item.previewUrl}
                    className="flex items-center justify-between"
                  >
                    <a
                      href={item.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                    >
                      {item.previewUrl.replace(/^blob:/, "")}
                    </a>
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="text-red-600 dark:text-red-400 ml-2"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-black dark:bg-zinc-700 text-white rounded hover:bg-gray-800 dark:hover:bg-zinc-600 transition-colors"
        >
          {submitting ? "Creating Hotel..." : "Create Hotel"}
        </button>
      </form>

      {/* Return to Home Button */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
        >
          Return to Home
        </button>
      </div>
    </div>
  );
}
