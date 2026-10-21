import "./globals.css";
import NavigationBar from "./components/NavigationBar";
import { FeedbackProvider } from "./context/FeedbackContext";
import { ThemeProvider } from "./context/ThemeContext";
import { Analytics } from "@vercel/analytics/next";
import { SessionProvider } from "./context/SessionProvider";
import Link from "next/link";

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
            <a href="#main-content" className="skip-link">Skip to content</a>
            <NavigationBar />
            {/* Resolve lazy route content inside a client component during hydration replay. */}
            <main id="main-content" className="app-main" tabIndex={-1}><SessionProvider>{children}</SessionProvider></main>
            <footer className="site-footer">
              <Link href="/">FlyNext</Link>
              <span className="site-footer-links">
                <Link href="/hotels/owner">Host workspace</Link>
                <span className="site-footer-divider" aria-hidden="true" />
                <a className="site-footer-github" href="https://github.com/REEEEEAAAAAL/FlyNext" aria-label="FlyNext source code on GitHub" title="Source code on GitHub">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.791-1.509-3.791-1.509-.512-1.3-1.25-1.646-1.25-1.646-1.022-.699.078-.685.078-.685 1.13.08 1.725 1.16 1.725 1.16 1.005 1.723 2.637 1.225 3.278.937.103-.729.393-1.225.715-1.507-2.499-.284-5.126-1.25-5.126-5.565 0-1.23.44-2.232 1.16-3.02-.116-.284-.503-1.43.11-2.98 0 0 .945-.302 3.094 1.154A10.79 10.79 0 0 1 12 6.177c.956.005 1.917.13 2.813.379 2.148-1.456 3.092-1.154 3.092-1.154.615 1.55.228 2.696.112 2.98.722.788 1.158 1.79 1.158 3.02 0 4.327-2.631 5.278-5.138 5.557.404.35.766 1.042.766 2.1 0 1.517-.014 2.741-.014 3.113 0 .3.203.65.774.54A11.251 11.251 0 0 0 12 .75Z" />
                  </svg>
                </a>
              </span>
            </footer>
          </FeedbackProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
