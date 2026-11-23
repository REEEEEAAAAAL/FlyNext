"use client";

import { NOTIFICATION_READ_EVENT } from "@/app/lib/notification-events";
import { getAccessToken, sessionFetch, subscribeToAccessToken } from "@/app/lib/session";
import Link from "next/link";
import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 5000;
const MAX_BACKOFF_MS = 120_000;

/**
 * Updates the unread count on a timer and immediately after a successful read.
 * All refresh triggers share one request and timer, so a read during a poll
 * queues a fresh count without letting the older poll overwrite it.
 */
export default function NotificationBadge() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let active = true;
        let inFlight = false;
        let refreshPending = false;
        let unauthorized = false;
        let delay = POLL_INTERVAL_MS;
        let retryAt = 0;

        function clearTimer() {
            clearTimeout(timer);
            timer = undefined;
        }

        function refresh() {
            clearTimer();
            const token = getAccessToken();
            if (!active || document.hidden || unauthorized || !token) return;
            if (inFlight) {
                refreshPending = true;
                return;
            }

            // User-triggered refreshes share the polling endpoint's backoff.
            const remaining = retryAt - Date.now();
            if (remaining > 0) {
                timer = setTimeout(refresh, remaining);
                return;
            }
            void poll(token);
        }

        async function poll(token: string) {
            inFlight = true;
            refreshPending = false;
            try {
                const response = await sessionFetch("/api/notifications/unread-count");
                if (!active || token !== getAccessToken()) return;

                if (response.status === 401) {
                    unauthorized = true;
                } else if (response.status === 429) {
                    const retryAfter = Number(response.headers.get("retry-after"));
                    const nextDelay = Number.isFinite(retryAfter) && retryAfter > 0
                        ? retryAfter * 1000
                        : delay * 2;
                    delay = Math.min(nextDelay, MAX_BACKOFF_MS);
                    retryAt = Date.now() + delay;
                } else if (response.ok) {
                    const data: { unreadCount: number } = await response.json();
                    if (active && !refreshPending && token === getAccessToken()) {
                        setCount(data.unreadCount);
                    }
                    delay = POLL_INTERVAL_MS;
                }
            } catch {
                // Keep the last count until a refresh succeeds.
            } finally {
                inFlight = false;
                if (active && !document.hidden && !unauthorized) {
                    if (refreshPending) refresh();
                    else if (getAccessToken()) timer = setTimeout(refresh, delay);
                }
            }
        }

        const unsubscribe = subscribeToAccessToken(() => {
            unauthorized = false;
            delay = POLL_INTERVAL_MS;
            retryAt = 0;
            if (!getAccessToken()) setCount(0);
            refresh();
        });

        document.addEventListener("visibilitychange", refresh);
        window.addEventListener(NOTIFICATION_READ_EVENT, refresh);
        refresh();

        return () => {
            active = false;
            clearTimer();
            unsubscribe();
            document.removeEventListener("visibilitychange", refresh);
            window.removeEventListener(NOTIFICATION_READ_EVENT, refresh);
        };
    }, []);

    return (
        <Link href="/notifications" className="header-icon" title="Notifications" aria-label={`Notifications${count ? `, ${count} unread` : ""}`}>
            <div className="relative cursor-pointer">
                <svg
                    aria-hidden="true"
                    className="w-5 h-5"
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
                    /*
                     * The pill is opaque in both themes. A translucent red over
                     * the dark navigation bar washes out to an indistinct smudge
                     * and stops reading as a count, so the only property that
                     * changes with the theme is the shade of red — a darker,
                     * less glaring one in dark mode.
                     */
                    <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center px-0.5 text-[10px] font-semibold leading-none text-white opacity-100 bg-red-600 rounded-full dark:bg-red-500 dark:text-white">
                        {count > 99 ? "99+" : count}
                    </span>
                )}
            </div>
        </Link>
    );
}
