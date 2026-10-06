"use client";

import { useTheme, type ResolvedTheme } from "@/app/context/ThemeContext";

const LABELS: Record<ResolvedTheme, string> = {
  light: "light",
  dark: "dark",
};

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.657-6.343l-1.414 1.414M7.757 16.243l-1.414 1.414m12.728 0l-1.414-1.414M7.757 7.757L6.343 6.343"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 20h8M12 16v4" />
    </svg>
  );
}

/**
 * Theme switcher for the navigation bar.
 *
 * The glyph is the action, not the current state: a sun means "click for
 * light", a moon means "click for dark". That is the convention users arrive
 * with, and the alternative — showing the mode you are already in — reads as a
 * label for the current state and makes the button look inert.
 *
 * The switch is a direct light/dark toggle rather than a cycle through the
 * stored preference. A three-way cycle can land on `system`, which changes
 * nothing visible when the OS already agrees with the resolved theme, so the
 * button appears to have done nothing. `ThemeContext` still honours a stored
 * `system` preference from an earlier visit or the bootstrap script; the first
 * click simply pins the opposite of what is on screen.
 *
 * Before the client mounts it renders the neutral `system` glyph rather than
 * guessing: the server cannot know the stored preference, and rendering a guess
 * would either mismatch on hydration or flicker. The bootstrap script in
 * `layout.tsx` has already painted the correct theme by then, so only the icon
 * settles a tick later.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { mounted, setTheme, resolvedTheme } = useTheme();

  const active: ResolvedTheme = mounted ? resolvedTheme : "light";
  const next: ResolvedTheme = active === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${LABELS[next]} mode`}
      title={`Switch to ${LABELS[next]} mode`}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-gray-800 text-gray-200 transition-colors hover:bg-gray-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 ${className}`}
    >
      {/* The action, not the state: sun while dark, moon while light. */}
      {mounted ? (
        active === "dark" ? (
          <SunIcon />
        ) : (
          <MoonIcon />
        )
      ) : (
        <SystemIcon />
      )}
    </button>
  );
}
