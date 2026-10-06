import "./globals.css";
import NavigationBar from "./components/NavigationBar";
import { FeedbackProvider } from "./context/FeedbackContext";
import { ThemeProvider } from "./context/ThemeContext";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "FlyNext",
  description: "Your travel companion",
};

/**
 * Runs before the first paint, so the document is already painted in the stored
 * theme and no flash of the light palette can appear on refresh.
 *
 * Details that matter:
 * - It is a plain, synchronous inline script: Next.js inlines it into `<head>`
 *   and the parser blocks on it, which is what makes it pre-paint.
 * - It only touches `document.documentElement`, never React-rendered markup, so
 *   it cannot cause a hydration mismatch.
 * - `system` (and any unset/failed read) falls through to the OS preference, so
 *   a first-time visitor gets the right theme too.
 * - Every branch is wrapped in try/catch: Safari private mode throws on
 *   `localStorage`, and a thrown bootstrap would abort the rest of the head.
 */
const themeBootstrapScript = `
(function () {
  try {
    var stored = null;
    try { stored = localStorage.getItem('theme'); } catch (e) { stored = null; }
    var prefersDark = false;
    try {
      prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) { prefersDark = false; }
    var isDark = stored === 'dark' || (stored !== 'light' && prefersDark);
    var root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `suppressHydrationWarning` is required because the bootstrap script above
    // mutates the class/style of this very element before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-screen antialiased">
        {/*
          * `FeedbackProvider` wraps the whole app so that a toast raised from any
          * page lands in one fixed stack at the top of the viewport, and so the
          * confirmation dialog can cover the navigation bar as well as the page.
          */}
        <ThemeProvider>
          <FeedbackProvider>
            <NavigationBar />
            {children}
          </FeedbackProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
