"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import NotificationBadge from "@/app/components/NotificationBadge";
import ThemeToggle from "@/app/components/ThemeToggle";
import { clearAccessToken } from "@/app/lib/session";

const NavigationBar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check for authentication on mount and when pathname changes.
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    setIsAuthenticated(!!token);
  }, [pathname]);

  // Close the mobile drawer whenever the route changes, so a navigation made
  // from inside the drawer does not leave it covering the new page.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      /*
       * The local session is cleared even when the server refuses, because the
       * endpoint only revokes the refresh cookie and is documented as reachable
       * with an empty token — so a non-`ok` answer here would otherwise leave the
       * user permanently "logged in" with no working Logout, since nothing else on
       * the client can drop the httpOnly refresh cookie.
       */
      if (!res.ok) {
        console.error("Logout failed:", res.status);
      }
      clearAccessToken();
      router.push("/auth/login");
    } catch (error) {
      console.error("Logout failed:", error);
      // Same reasoning as above: a network failure must not trap the user.
      clearAccessToken();
      router.push("/auth/login");
    }
  };

  const navLinks = [
    { name: "Home", href: "/" },
    { name: "Flight Search", href: "/flights" },
    { name: "Hotel Search", href: "/hotels" },
    { name: "Hotel Owner", href: "/hotels/owner" },
    { name: "Create My Itinerary", href: "/itineraries/new" },
    { name: "My Itineraries", href: "/itineraries" },
    { name: "My Flight Bookings", href: "/user/flight-bookings" },
    { name: "My Hotel Bookings", href: "/user/hotel-bookings" },
  ];

  return (
    <>
      {/*
        The bar is its own surface in both themes: near-black in light mode and
        zinc-900 in dark mode, so it stays a distinct layer above the zinc-950
        canvas instead of dissolving into it. The hairline bottom border does
        the separation job that the light-theme shadow cannot do on dark.
      */}
      <nav className="bg-black text-white shadow-lg dark:bg-zinc-900 dark:shadow-none dark:border-b dark:border-white/10">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20">
            <div className="flex items-center">
              <Link href="/" className="flex-shrink-0 flex items-center">
                <span className="text-xl font-bold text-white">FlyNext</span>
              </Link>
              <div className="hidden md:ml-8 md:flex md:space-x-6">
                {navLinks.slice(0, 4).map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      pathname === link.href
                        ? "border-blue-400 text-white"
                        : "border-transparent text-gray-300 hover:border-gray-400 hover:text-white dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-white"
                    }`}
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
            </div>
            <div className="hidden md:ml-6 md:flex md:items-center md:space-x-4">
              {navLinks.slice(4).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium ${
                    pathname === link.href
                      ? "bg-gray-800 text-white"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                  }`}
                >
                  {link.name}
                </Link>
              ))}
              <ThemeToggle />
              <div className="flex items-center space-x-4">
                {isAuthenticated && <NotificationBadge />}
                {isAuthenticated ? (
                  <div className="relative inline-block group">
                    <button
                      type="button"
                      className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                    >
                      User Menu
                    </button>
                    {/*
                      Hover-revealed menu. It is a floating layer, so it takes
                      the raised dark surface and keeps its own border rather
                      than relying on the light-mode shadow.
                    */}
                    <div className="absolute right-0 top-full mt-0 hidden w-48 floating overflow-hidden group-hover:block z-50">
                      <Link
                        href="/profile"
                        className="block px-4 py-2 text-sm text-gray-800 row-hover dark:text-zinc-200"
                      >
                        Profile
                      </Link>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-sm text-gray-800 row-hover dark:text-zinc-200"
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                ) : (
                  <Link
                    href="/auth/login"
                    className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  >
                    Login
                  </Link>
                )}
              </div>
            </div>
            <div className="-mr-2 flex items-center gap-2 md:hidden">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle main menu"
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-300 hover:text-white hover:bg-gray-700 focus:outline-none dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                <svg
                  className="h-6 w-6"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  {mobileMenuOpen ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className={`md:hidden ${mobileMenuOpen ? "block" : "hidden"}`}>
          <div className="pt-2 pb-4 space-y-1 bg-gray-900 dark:bg-zinc-900/80 dark:border-t dark:border-white/10">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`block pl-3 pr-4 py-3 border-l-4 text-base font-medium ${
                  pathname === link.href
                    ? "bg-gray-800 border-blue-400 text-white"
                    : "border-transparent text-gray-300 hover:bg-gray-800 hover:border-gray-400 hover:text-white dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:border-zinc-500 dark:hover:text-white"
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>
      </nav>
      {/*
        Spacer sits on the page canvas rather than on a fixed colour: inheriting
        `--background` keeps the gap under the bar matching the surface in both
        themes, where a hard-coded light value would show as a bright band
        against the dark canvas.
      */}
      <div className="h-8 bg-[var(--background)]" />
    </>
  );
};

export default NavigationBar;
