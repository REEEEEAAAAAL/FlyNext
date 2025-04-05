"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Notification {
  id: number;
  content: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Redirect to login if no access token is found.
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
            localStorage.removeItem("accessToken");

            // Instead of going directly to login, go to refresh page
            router.push("/auth/refresh");
            return;
        }
    };

    fetchData();
  }, [router]);

  // Fetch notifications from the backend.
  useEffect(() => {
    async function fetchNotifications() {
      setLoading(true);
      setError("");
      try {
        const token = localStorage.getItem("accessToken");
        const res = await fetch("/api/notifications", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to fetch notifications.");
        } else {
          const data = await res.json();
          // Assuming the API returns an object with a "notifications" array.
          setNotifications(data.notifications || []);
        }
      } catch (err) {
        setError("An error occurred while fetching notifications.");
      } finally {
        setLoading(false);
      }
    }
    fetchNotifications();
  }, []);

  // Mark a notification as read.
  const markAsRead = async (notificationId: number) => {
    try {
      const token = localStorage.getItem("accessToken");
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((notif) =>
            notif.id === notificationId ? { ...notif, isRead: true } : notif
          )
        );
      } else {
        const data = await res.json();
        console.error(data.error || "Failed to mark notification as read.");
      }
    } catch (err) {
      console.error("An error occurred while marking notification as read.");
    }
  };

  return (
    <div className="min-h-screen max-w-3xl mx-auto p-8 bg-white text-black shadow-md rounded">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Notifications</h1>
      {loading && <p className="text-gray-600">Loading notifications...</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && notifications.length === 0 && (
        <p className="text-gray-600">No notifications found.</p>
      )}
      <ul className="space-y-4">
        {notifications.map((notif) => (
          <li
            key={notif.id}
            className="p-4 border border-gray-300 rounded bg-gray-50 flex justify-between items-center"
          >
            <div>
              <p className="text-gray-800">{notif.content}</p>
              <p className="text-sm text-gray-500">
                {new Date(notif.createdAt).toLocaleString()}
              </p>
            </div>
            {!notif.isRead && (
              <button
                onClick={() => markAsRead(notif.id)}
                className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              >
                Mark as Read
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
