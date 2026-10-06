"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearAccessToken } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

/**
 * The profile fields the form reads.
 *
 * `phone` and `profilePic` are nullable columns, and the `PUT` response carries
 * the raw row rather than the `GET` shape (which substitutes the bundled
 * placeholder for a missing avatar). Declaring them as plain strings is what
 * lets a `null` reach a controlled input — React then flips it to uncontrolled
 * on the next keystroke — so they are typed nullable and normalised at the two
 * places that render them.
 */
interface ProfileData {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string;
    profilePic: string | null;
    profilePicFile?: File;
}

/** Banner state; `""` means "nothing to show". */
type Message = { type: "" | "success" | "error"; text: string };

/**
 * The message of a thrown value, for display in the banner.
 *
 * `catch` binds `unknown` under `strict`, so this is the single narrowing point
 * for both handlers — and it keeps a body-less error (`message === ""`) from
 * rendering an empty banner.
 */
function toErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0
        ? error.message
        : fallback;
}

/**
 * Turn a stored `profilePic` into something `<img src>` can load.
 *
 * Two shapes reach this function. A bundled placeholder, or an avatar stored on
 * this origin, is a root-relative path (`/user-profile-default.svg`) and needs
 * its leading slash ensured. A Cloudinary address is already absolute
 * (`https://res.cloudinary.com/...`) — prefixing that with a slash
 * produces `/https://...`, which the browser resolves as a path on this origin
 * and fails to load. The cache-busting suffix is appended either way, because an
 * avatar that keeps its URL after a re-upload would otherwise be served from the
 * browser's cache.
 */
function toPreviewSrc(profilePic: string): string {
    const absolute = /^https?:\/\//i.test(profilePic);
    const src = absolute || profilePic.startsWith("/") ? profilePic : `/${profilePic}`;
    return `${src}${src.includes("?") ? "&" : "?"}v=${Date.now()}`;
}

export default function ProfilePage() {
    const router = useRouter();
    const { success, error: toastError } = useFeedback();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<Message>({ type: "", text: "" });
    const [profileData, setProfileData] = useState<ProfileData>({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        profilePic: "",
    });
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    /*
     * Record an outcome in both places it is needed.
     *
     * The page's own banner is user-visible state that has to be rendered, and
     * the toast is what actually gets noticed — a save that fails at the bottom
     * of a long form would otherwise leave the only explanation at the top of
     * the card. One helper, so the two can never disagree about what happened.
     */
    const report = (type: "success" | "error", text: string) => {
        setMessage({ type, text });
        if (type === "success") {
            success("Profile updated", { description: text });
        } else {
            toastError("Profile not updated", { description: text });
        }
    };

    // Fetch user profile on component mount.
    useEffect(() => {
        const fetchProfile = async () => {
            try {
                setLoading(true);
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

                if (response.ok) {
                    const data = (await response.json()) as { user?: ProfileData };

                    /*
                     * The form below is controlled by `profileData`, so handing
                     * it a missing object would flip every input to uncontrolled
                     * and the next keystroke would throw. A response without a
                     * `user` is treated as a failure to load rather than as an
                     * empty profile.
                     */
                    const user = data.user;
                    if (!user) {
                        report("error", "Failed to load profile");
                        return;
                    }

                    setProfileData(user);
                    if (user.profilePic) {
                        setPreviewImage(toPreviewSrc(user.profilePic));
                    }
                } else {
                    const errorData = await response.json();
                    report(
                        "error",
                        errorData.error || "Failed to load profile"
                    );
                }
            } catch (error) {
                report("error", toErrorMessage(error, "An error occurred"));
            } finally {
                setLoading(false);
            }
        };

        fetchProfile();
    }, [router]);

  const handleImageError = () => {
      setPreviewImage("/user-profile-default.svg");
  };


    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setProfileData((prev) => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files ? e.target.files[0] : null;
        if (file) {
            const fileUrl: string = URL.createObjectURL(file);
            setPreviewImage(fileUrl);
            setProfileData((prev) => ({
                ...prev,
                profilePicFile: file,
            }));
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);
        setMessage({ type: "", text: "" });

        try {
            const token = localStorage.getItem("accessToken");
            if (!token) {
                router.push("/auth/login");
                return;
            }

            /*
             * The save is a single request. A pre-flight `GET` would inspect
             * exactly one thing — a `401` — and discard every other answer,
             * including a `500`, before the write was attempted anyway. The write
             * below handles that same `401` itself, which keeps a whole request
             * (and a rate-limit token) off every save.
             */

            // Using FormData to handle file upload.
            const formDataToSend = new FormData();
            formDataToSend.append("firstName", profileData.firstName);
            formDataToSend.append("lastName", profileData.lastName);
            formDataToSend.append("phone", profileData.phone ?? "");

            if (profileData.profilePicFile) {
                formDataToSend.append("profilePic", profileData.profilePicFile);
            }

            const response = await fetch("/api/user", {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formDataToSend,
            });

            if (response.status === 401) {
                /*
                 * The token expired between opening the form and saving it.
                 * Clearing it is what stops the mounted notification badge from
                 * polling with a dead token; going to `/auth/refresh` is what
                 * gets a usable one back without making the user log in again.
                 */
                clearAccessToken();
                router.push("/auth/refresh");
                return;
            }

            const data = (await response.json()) as {
                error?: string;
                user?: ProfileData;
            };

            if (response.ok) {
                report("success", "Profile updated successfully!");

                /*
                 * The write has already reached the database, so a response with
                 * no `user` must not be reported as a failure. It also leaves
                 * nothing to rebuild the controlled inputs from, and spreading
                 * `undefined` would blank every field; the submitted values stay
                 * on screen instead, because they are what was saved.
                 */
                const updated = data.user;
                if (!updated) {
                    return;
                }

                setProfileData({
                    ...updated,
                    profilePicFile: undefined, // Clear the file object.
                });
                if (updated.profilePic) {
                    setPreviewImage(toPreviewSrc(updated.profilePic));
                }
            } else {
                report("error", data.error || "Failed to update profile");
            }
        } catch (error) {
            report("error", toErrorMessage(error, "An error occurred"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
                <div className="text-center p-6">
                    <div className="w-12 h-12 border-4 border-blue-600 dark:border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-[var(--text)]">Loading profile...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--background)] py-12 px-4 sm:px-6 lg:px-8 text-[var(--text)]">
            <div className="max-w-md mx-auto card rounded-xl overflow-hidden md:max-w-2xl">
                <div className="md:flex">
                    <div className="p-8 w-full">
                        <div className="flex justify-between items-center mb-6">
                            <h1 className="text-2xl font-bold text-[var(--text)]">
                                My Profile
                            </h1>
                            <button
                                onClick={() => router.push("/")}
                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                                Back to Home Page
                            </button>
                        </div>
                        {message.text && (
                            <div
                                className={`p-4 mb-6 rounded-md ${
                                    message.type === "error"
                                        ? "bg-red-50 text-red-700 border-l-4 border-red-600 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/50"
                                        : "bg-green-50 text-green-700 border-l-4 border-green-600 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/50"
                                }`}
                            >
                                {message.text}
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Profile Picture */}
                            <div className="flex flex-col items-center">
                                {/*
                                  The default avatar asset is a white disc on a
                                  very light grey ring, so on a light canvas the
                                  disc has no edge and the 128px circle reads as
                                  a shapeless area (measured 1.1:1 against the
                                  canvas).

                                  `ring-gray-500` / `dark:ring-zinc-500` are the
                                  lightest available steps that clear the 3:1
                                  WCAG non-text threshold for a control boundary
                                  — gray-400 measures only 2.3:1 and zinc-600
                                  2.6:1, both below the threshold. The
                                  same ring also gives an uploaded photo a
                                  defined edge.
                                */}
                                <div className="w-32 h-32 rounded-full overflow-hidden mb-3 bg-gray-200 dark:bg-zinc-700 relative ring-1 ring-gray-500 dark:ring-zinc-500">
                                    {previewImage ? (
                                        <img
                                            src={previewImage}
                                            onError={handleImageError}
                                            alt="Profile Preview"
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <img
                                            src={"/user-profile-default.svg"}
                                            alt="Profile"
                                            className="w-full h-full object-cover"
                                        />
                                    )}
                                </div>
                                <label className="cursor-pointer text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-2">
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
                                    Upload Photo
                                    <input
                                        type="file"
                                        name="profilePic"
                                        onChange={handleFileChange}
                                        accept="image/jpeg,image/png,image/webp"
                                        aria-label="Upload profile photo"
                                        className="hidden"
                                    />
                                </label>
                                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                                    Max size: 5MB (JPEG, PNG, WebP)
                                </p>
                            </div>

                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {/* First Name */}
                                <div>
                                    <label
                                        htmlFor="firstName"
                                        className="block text-sm font-medium text-[var(--text)]"
                                    >
                                        First Name
                                    </label>
                                    <input
                                        type="text"
                                        id="firstName"
                                        name="firstName"
                                        value={profileData.firstName}
                                        onChange={handleInputChange}
                                        required
                                        className="mt-1 field"
                                    />
                                </div>

                                {/* Last Name */}
                                <div>
                                    <label
                                        htmlFor="lastName"
                                        className="block text-sm font-medium text-[var(--text)]"
                                    >
                                        Last Name
                                    </label>
                                    <input
                                        type="text"
                                        id="lastName"
                                        name="lastName"
                                        value={profileData.lastName}
                                        onChange={handleInputChange}
                                        required
                                        className="mt-1 field"
                                    />
                                </div>
                            </div>

                            {/* Email - Read Only */}
                            <div>
                                <label
                                    htmlFor="email"
                                    className="block text-sm font-medium text-[var(--text)]"
                                >
                                    Email Address
                                </label>
                                <input
                                    type="email"
                                    id="email"
                                    value={profileData.email}
                                    readOnly
                                    className="mt-1 field bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-zinc-400"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                                    Email address cannot be changed
                                </p>
                            </div>

                            {/* Phone */}
                            <div>
                                <label
                                    htmlFor="phone"
                                    className="block text-sm font-medium text-[var(--text)]"
                                >
                                    Phone Number
                                </label>
                                <input
                                    type="tel"
                                    id="phone"
                                    name="phone"
                                    value={profileData.phone ?? ""}
                                    onChange={handleInputChange}
                                    className="mt-1 field"
                                />
                            </div>

                            {/* Submit Button */}
                            <div className="flex items-center justify-end">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus:ring-offset-zinc-900 dark:disabled:bg-blue-900/50 dark:disabled:text-zinc-400"
                                >
                                    {saving ? (
                                        <>
                                            <svg
                                                className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                                                xmlns="http://www.w3.org/2000/svg"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                            >
                                                <circle
                                                    className="opacity-25"
                                                    cx="12"
                                                    cy="12"
                                                    r="10"
                                                    stroke="currentColor"
                                                    strokeWidth="4"
                                                ></circle>
                                                <path
                                                    className="opacity-75"
                                                    fill="currentColor"
                                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                ></path>
                                            </svg>
                                            Saving...
                                        </>
                                    ) : (
                                        "Save Changes"
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
