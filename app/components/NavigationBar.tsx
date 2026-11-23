"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getAccessToken, subscribeToAccessToken } from "@/app/lib/session";
import ThemeToggle from "./ThemeToggle";
import NotificationBadge from "./NotificationBadge";

const primary = [["/flights", "Flights"], ["/hotels", "Stays"], ["/itineraries", "My trips"]];
const account = [["/profile", "Profile"], ["/itineraries/new", "Build an itinerary"], ["/user/flight-bookings", "Flight bookings"], ["/user/hotel-bookings", "Hotel bookings"]];
export default function NavigationBar() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const mobileMenu = useRef<HTMLElement>(null);
  useEffect(() => { setSignedIn(!!getAccessToken()); return subscribeToAccessToken(() => setSignedIn(!!getAccessToken())); }, []);
  useEffect(() => { setMobile(false); setOpen(false); }, [pathname]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menu.current?.contains(target)) setOpen(false);
      if (!mobileTrigger.current?.contains(target) && !mobileMenu.current?.contains(target)) setMobile(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const links = (items: string[][]) => items.map(([href, label]) => <Link key={href} href={href} onClick={() => { setOpen(false); setMobile(false); }} aria-current={pathname === href ? "page" : undefined} className="nav-link">{href === "/flights" && <svg className="nav-link-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m17.8 19.2-1.8-8.2 3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 5 6.2c-.5-.1-1 .1-1.2.6-.1.4 0 .9.4 1.2l5.1 3.8-2 2-2.3-.5-1.2 1.2 3.2 1.1 1.1 3.2 1.2-1.2-.5-2.3 2-2 3.8 5.1c.3.4.8.6 1.2.4.5-.2.7-.7.6-1.2z" /></svg>}{href === "/hotels" && <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M2 21h20M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-5h4v5" /></svg>}{href === "/itineraries" && <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5 8 4l8 3 5-2.5v13L16 20l-8-3-5 2.5zM8 4v13m8-10v13" /><circle cx="12" cy="11" r="1.5" /></svg>}{label}</Link>);
  const navigationToggle = (
    <button ref={mobileTrigger} className="mobile-trigger button-secondary" aria-label="Toggle navigation" aria-controls="mobile-navigation" aria-expanded={mobile} onClick={() => { setOpen(false); setMobile(!mobile); }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={mobile ? "m6 6 12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"}/></svg></button>
  );
  return <header className="site-header" onKeyDown={(event) => { if (event.key === "Escape" && (open || mobile)) { setOpen(false); setMobile(false); (mobile ? mobileTrigger : trigger).current?.focus(); } }}>
    <div className="nav-shell">
      <div className="nav-brand-group">
        {signedIn && navigationToggle}
        <Link href="/" className="brand" title="FlyNext home"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m5 17 22-11-8 22-4-9-10-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="m15 19 12-13" stroke="currentColor" strokeWidth="2" /></svg>FlyNext</Link>
      </div>
      <nav aria-label="Primary" className="desktop-nav">{links(primary)}</nav>
      <div className="nav-actions"><ThemeToggle />
        {signedIn && <NotificationBadge />}
        {signedIn ? <div className="relative" ref={menu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
          <button
            ref={trigger}
            type="button"
            className="header-icon"
            aria-label="My account"
            title="My account"
            aria-expanded={open}
            aria-controls="account-links"
            onClick={() => { setMobile(false); setOpen(!open); }}
          >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 20c.6-4 3.3-6 7.5-6s6.9 2 7.5 6" />
              </svg>
          </button>
          {open && <nav id="account-links" aria-label="Account" className="account-dropdown floating">{links(account.slice(0, 1))}<hr className="account-dropdown-divider" />{links(account.slice(1))}<hr className="account-dropdown-divider" />{links([["/hotels/owner", "Host workspace"]])}<hr className="account-dropdown-divider" />{links([["/auth/logout", "Log out"]])}</nav>}
        </div> : <Link href="/auth/login" className="button-secondary">Sign in</Link>}
        {!signedIn && navigationToggle}
      </div>
    </div>
    {mobile && <nav ref={mobileMenu} id="mobile-navigation" className="mobile-navigation" aria-label="Mobile navigation">
      {links(primary)}
    </nav>}
  </header>;
}
