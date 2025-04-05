"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface ProfileData {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    profilePic: string;
    profilePicFile?: File;
}

export default function ProfilePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState({ type: "", text: "" });
    const [profileData, setProfileData] = useState<ProfileData>({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        profilePic: "",
    });
    const [previewImage, setPreviewImage] = useState<string | null>(null);

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
                    localStorage.removeItem("accessToken");

                    // Instead of going directly to login, go to refresh page
                    router.push("/auth/refresh");
                    return;
                }

                if (response.ok) {
                    const data = await response.json();
                    setProfileData(data.user);
                    if (data.user.profilePic) {
                        setPreviewImage(
                            `${
                                data.user.profilePic.startsWith("/")
                                    ? data.user.profilePic
                                    : `/${data.user.profilePic}`
                            }?${new Date().getTime()}`
                        );
                    }
                } else {
                    const errorData = await response.json();
                    setMessage({
                        type: "error",
                        text: errorData.error || "Failed to load profile",
                    });
                }
            } catch (error) {
                setMessage({
                    type: "error",
                    text: (error as Error).message || "An error occurred",
                });
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

            const response1 = await fetch("/api/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response1.status === 401) {
                localStorage.removeItem("accessToken");
                router.push("/auth/refresh");
                return;
            }

            // Using FormData to handle file upload.
            const formDataToSend = new FormData();
            formDataToSend.append("firstName", profileData.firstName);
            formDataToSend.append("lastName", profileData.lastName);
            formDataToSend.append("phone", profileData.phone || "");

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

            const data = await response.json();
            if (response.ok) {
                setMessage({
                    type: "success",
                    text: "Profile updated successfully!",
                });
                setProfileData({
                    ...data.user,
                    profilePicFile: undefined, // Clear the file object.
                });
                if (data.user.profilePic) {
                    setPreviewImage(
                        `${
                            data.user.profilePic.startsWith("/")
                                ? data.user.profilePic
                                : `/${data.user.profilePic}`
                        }?${new Date().getTime()}`
                    );
                }
            } else {
                setMessage({
                    type: "error",
                    text: data.error || "Failed to update profile",
                });
            }
        } catch (error: any) {
            setMessage({
                type: "error",
                text: error.message || "An error occurred",
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
                <div className="text-center p-6">
                    <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-[var(--text)]">Loading profile...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--background)] py-12 px-4 sm:px-6 lg:px-8 text-[var(--text)]">
            <div className="max-w-md mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden md:max-w-2xl">
                <div className="md:flex">
                    <div className="p-8 w-full">
                        <div className="flex justify-between items-center mb-6">
                            <h1 className="text-2xl font-bold text-[var(--text)]">
                                My Profile
                            </h1>
                            <button
                                onClick={() => router.push("/")}
                                className="text-blue-600 hover:text-blue-800"
                            >
                                Back to Home Page
                            </button>
                        </div>
                        {message.text && (
                            <div
                                className={`p-4 mb-6 rounded-md ${
                                    message.type === "error"
                                        ? "bg-red-50 text-red-700 border-l-4 border-red-600"
                                        : "bg-green-50 text-green-700 border-l-4 border-green-600"
                                }`}
                            >
                                {message.text}
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Profile Picture */}
                            <div className="flex flex-col items-center">
                                <div className="w-32 h-32 rounded-full overflow-hidden mb-3 bg-gray-200 dark:bg-gray-600 relative">
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
                                    Upload Photo
                                    <input
                                        type="file"
                                        name="profilePic"
                                        onChange={handleFileChange}
                                        accept="image/jpeg,image/png,image/webp"
                                        className="hidden"
                                    />
                                </label>
                                <p className="text-xs text-gray-500 mt-1">
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
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
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
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
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
                                    className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 text-gray-500 shadow-sm"
                                />
                                <p className="mt-1 text-xs text-gray-500">
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
                                    value={
                                        profileData.phone
                                            ? profileData.phone
                                            : ""
                                    }
                                    onChange={handleInputChange}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                />
                            </div>

                            {/* Submit Button */}
                            <div className="flex items-center justify-end">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300 disabled:cursor-not-allowed"
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
