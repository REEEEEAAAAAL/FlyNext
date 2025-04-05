"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NotificationBadge() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

    const fetchNotificationCount = async () => {
        try {
            const token = localStorage.getItem("accessToken");
            const res = await fetch("/api/notifications/unread-count", {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: token ? `Bearer ${token}` : "",
                },
            });
            if (res.ok) {
                const data = await res.json();
                // Assuming the API returns an object like { unreadCount: number }
                setCount(data.unreadCount || 0);
            }
        } catch (error) {
            console.error("Error fetching notification count", error);
        }
    }

    useEffect(() => {
        fetchNotificationCount();

        const interval = setInterval(fetchNotificationCount, 5000); 

        return () => clearInterval(interval);
    }, []);
  
  useEffect(() => {
      if (pathname === "/notifications") {
          fetchNotificationCount();
      }
  }, [pathname]);


    return (
        <Link href="/notifications">
            <div className="relative cursor-pointer">
                <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V4a2 2 0 10-4 0v1.341C7.67 7.165 6 9.388 6 12v2.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1"
                    ></path>
                </svg>
                {count > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 bg-red-600 rounded-full">
                        {count}
                    </span>
                )}
            </div>
        </Link>
    );
}
