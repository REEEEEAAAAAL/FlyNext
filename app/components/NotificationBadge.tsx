"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCESS_TOKEN_KEY, subscribeToAccessToken } from "@/app/lib/session";

/** How often the badge refreshes while the tab is visible. */
const POLL_INTERVAL_MS = 5000;

/** Longest back-off applied after the server asks the client to slow down. */
const MAX_BACKOFF_MS = 120_000;

/**
 * Notification counter for the navigation bar.
 *
 * The badge polls, so it is the one client component that can hurt the server on
 * its own: a forgotten timer, a dozen background tabs or an ignored `429` all turn
 * into a permanent query stream. Three rules keep it well behaved.
 *
 * - One timer, scheduled by `setTimeout`: the next poll is arranged only after
 *   the previous one settles, so a slow or failing request can never build a
 *   queue of overlapping fetches the way a fixed `setInterval` does.
 * - Back off when asked: the endpoint is rate limited and answers `429` with
 *   `Retry-After`; that value is honoured instead of retrying on the normal
 *   cadence, and the delay doubles on repeated refusals.
 * - Stop while hidden: a tab that is not being looked at has no reason to
 *   poll, so the timer is suspended and one refresh runs when it becomes visible
 *   again.
 *
 * `401` stops the loop outright: without a session there is nothing to count, and
 * the pages that need a token already redirect through `/auth/refresh`. The loop
 * resumes when a token is stored again — see `app/lib/session.ts`.
 */
export default function NotificationBadge() {
    const [count, setCount] = useState(0);
    const pathname = usePathname();

    /** Pending timer, so it can be cleared on unmount or on a path change. */
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Current delay between polls; grows after a `429` and resets on success. */
    const delayRef = useRef(POLL_INTERVAL_MS);
    /** Guards against a refresh being scheduled twice for the same tick. */
    const stoppedRef = useRef(false);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const fetchNotificationCount = useCallback(async () => {
        try {
            // Read the token on every tick rather than caching it: a `401` puts the
            // loop on hold, and the token that lifts the hold is issued later, by
            // `/auth/login` or `/auth/refresh`.
            const token = localStorage.getItem(ACCESS_TOKEN_KEY);
            if (!token) {
                // Nothing to poll for while logged out.
                stoppedRef.current = true;
                return;
            }

            const res = await fetch("/api/notifications/unread-count", {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.status === 401) {
                /*
                 * The session is gone, so there is nothing to count. The loop
                 * stops until a new token is stored, which re-arms the effect
                 * below through `subscribeToAccessToken` — without that
                 * subscription the badge stayed frozen on its last count for the
                 * rest of the page's life, because nothing remounts it while the
                 * user is navigating.
                 */
                stoppedRef.current = true;
                return;
            }

            if (res.status === 429) {
                // Honour the server's own figure when it provides one, and
                // otherwise double the delay, capped.
                const retryAfter = Number(res.headers.get("retry-after"));
                delayRef.current =
                    Number.isFinite(retryAfter) && retryAfter > 0
                        ? Math.min(retryAfter * 1000, MAX_BACKOFF_MS)
                        : Math.min(delayRef.current * 2, MAX_BACKOFF_MS);
                return;
            }

            if (res.ok) {
                const data = (await res.json()) as { unreadCount?: number };
                setCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
                delayRef.current = POLL_INTERVAL_MS;
            }
        } catch {
            // Offline or the request was aborted: keep the last known count and
            // let the next tick try again.
        }
    }, []);

    useEffect(() => {
        stoppedRef.current = false;
        delayRef.current = POLL_INTERVAL_MS;

        /** Run one poll, then schedule the next one. */
        const tick = async () => {
            if (stoppedRef.current) {
                return;
            }
            if (document.hidden) {
                // Suspended; `visibilitychange` below resumes the loop.
                timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
                return;
            }
            await fetchNotificationCount();
            if (!stoppedRef.current) {
                timerRef.current = setTimeout(tick, delayRef.current);
            }
        };

        void tick();

        const onVisibilityChange = () => {
            if (!document.hidden) {
                // Refresh immediately when the tab comes back, so the badge is
                // never showing a count that is minutes out of date.
                clearTimer();
                void tick();
            }
        };

        document.addEventListener("visibilitychange", onVisibilityChange);

        /*
         * A `401` stopped the loop; a new token is what restarts it. Without this
         * subscription the badge never recovered: nothing remounts it while the
         * user keeps navigating, so a single expired token froze the count until
         * the page was reloaded by hand.
         */
        const unsubscribe = subscribeToAccessToken(() => {
            clearTimer();
            stoppedRef.current = false;
            delayRef.current = POLL_INTERVAL_MS;
            /*
             * A session that ended has no unread count to show. Every page that
             * handles a `401` drops the token, and the loop stops on the next poll
             * either way — so without this the pill stayed on screen with the last
             * count it saw, next to a "Login" link, until a reload.
             */
            if (localStorage.getItem(ACCESS_TOKEN_KEY) === null) {
                setCount(0);
            }
            void tick();
        });

        return () => {
            stoppedRef.current = true;
            clearTimer();
            unsubscribe();
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [clearTimer, fetchNotificationCount]);

    // Marking a notification read on the notifications page changes the count, so
    // refresh on arrival there rather than waiting for the next tick.
    useEffect(() => {
        if (pathname === "/notifications") {
            void fetchNotificationCount();
        }
    }, [pathname, fetchNotificationCount]);

    return (
        <Link href="/notifications">
            <div className="relative cursor-pointer">
                <svg
                    className="w-6 h-6 text-white dark:text-zinc-200"
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
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white opacity-100 bg-red-600 rounded-full dark:bg-red-500 dark:text-white">
                        {count}
                    </span>
                )}
            </div>
        </Link>
    );
}
