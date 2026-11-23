"use client";

import { loginUrl } from "@/app/lib/return-path";
import { NOTIFICATION_READ_EVENT } from "@/app/lib/notification-events";
import { clearAccessToken, getAccessToken, sessionFetch } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

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
  const { success } = useFeedback();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [hasOlderUnread, setHasOlderUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingRead, setPendingRead] = useState<number | "all" | null>(null);
  const [error, setError] = useState("");
  const hasUnread = hasOlderUnread || notifications.some((notification) => !notification.isRead);

  // Redirect to login if no access token is found.
  useEffect(() => {
    const fetchData = async () => {
        const token = getAccessToken();
        if (!token) {
            // Redirect to login if no token found.
            router.push(loginUrl());
            return;
        }

        const response = await sessionFetch("/api/user", {
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

  // Fetch notifications from the backend.
  useEffect(() => {
    async function fetchNotifications() {
      setLoading(true);
      setError("");
      try {
        const token = getAccessToken();
        const res = await sessionFetch("/api/notifications", {
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
          const data: { notifications: Notification[]; hasOlderUnread: boolean } = await res.json();
          setNotifications(data.notifications);
          setHasOlderUnread(data.hasOlderUnread);
        }
      } catch {
        setError("An error occurred while fetching notifications.");
      } finally {
        setLoading(false);
      }
    }
    fetchNotifications();
  }, []);

  const markAsRead = async (target: number | "all") => {
    if (pendingRead !== null || (target === "all" && !hasUnread)) return;
    setPendingRead(target);
    setError("");
    const endpoint = target === "all"
      ? "/api/notifications/read-all"
      : `/api/notifications/${target}/read`;
    const failure = target === "all"
      ? "Could not mark all notifications as read. Please try again."
      : "Could not mark this notification as read. Please try again.";
    try {
      const res = await sessionFetch(endpoint, { method: "PUT" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || failure);
        return;
      }

      setNotifications((prev) => prev.map((notification) =>
        !notification.isRead && (target === "all" || notification.id === target)
          ? { ...notification, isRead: true }
          : notification
      ));
      if (target === "all") {
        setHasOlderUnread(false);
        success("All notifications marked as read");
      }
      window.dispatchEvent(new Event(NOTIFICATION_READ_EVENT));
    } catch {
      setError(failure);
    } finally {
      setPendingRead(null);
    }
  };

  return (
    <div className="page-shell page-shell--form records-page">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold heading">Notifications</h1>
        <button
          type="button"
          className="button-secondary aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
          aria-disabled={!hasUnread || pendingRead !== null}
          onClick={() => markAsRead("all")}
        >
          {pendingRead === "all" ? "Marking as read…" : "Mark all as read"}
        </button>
      </header>
      {loading && <p role="status" className="muted">Loading notifications...</p>}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      {!loading && !error && notifications.length === 0 && (
        <p className="record-panel muted">You’re all caught up. Booking updates will appear here.</p>
      )}
      <ul className="space-y-4">
        {notifications.map((notif) => (
          <li
            key={notif.id}
            className={`p-4 flex flex-wrap gap-4 justify-between items-center rounded-lg border transition-colors ${
              /*
               * Unread rows get a blue tint instead of a heavier border, so the
               * "needs attention" signal survives on a dark canvas without
               * relying on a shadow.
               */
              notif.isRead
                ? "border-[var(--line)] bg-[var(--surface)]"
                : "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10"
            }`}
          >
            <div>
              <p className="text-gray-800 dark:text-zinc-100">{notif.content}</p>
              <p className="text-sm muted">
                {new Date(notif.createdAt).toLocaleString("en-US")}
              </p>
            </div>
            {!notif.isRead && (
              <button
                type="button"
                disabled={pendingRead !== null}
                onClick={() => markAsRead(notif.id)}
                aria-label={`Mark as Read: ${notif.content}`}
                className="button-secondary"
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
