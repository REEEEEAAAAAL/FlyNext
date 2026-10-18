"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getAccessToken, subscribeToAccessToken } from "@/app/lib/session";
import ThemeToggle from "./ThemeToggle";
import NotificationBadge from "./NotificationBadge";

const primary = [["/flights", "Flights"], ["/hotels", "Stays"], ["/itineraries", "My trips"]];
const account = [["/itineraries/new", "Build an itinerary"], ["/user/flight-bookings", "Flight bookings"], ["/user/hotel-bookings", "Hotel bookings"], ["/profile", "Profile"], ["/hotels/owner", "Host workspace"]];
export default function NavigationBar() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setSignedIn(!!getAccessToken()); return subscribeToAccessToken(() => setSignedIn(!!getAccessToken())); }, []);
  useEffect(() => { setMobile(false); setOpen(false); }, [pathname]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const links = (items: string[][]) => items.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="nav-link">{label}</Link>);
  return <header className="site-header" onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); setMobile(false); (mobile ? mobileTrigger : trigger).current?.focus(); } }}>
    <div className="nav-shell">
      <Link href="/" className="brand" aria-label="FlyNext home"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m5 17 22-11-8 22-4-9-10-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="m15 19 12-13" stroke="currentColor" strokeWidth="2" /></svg>FlyNext<span className="demo-badge">DEMO</span></Link>
      <nav aria-label="Primary" className="desktop-nav">{links(primary)}</nav>
      <div className="nav-actions"><ThemeToggle className="nav-theme" /><div className="desktop-account">{signedIn && <NotificationBadge />}</div>
        <div className="desktop-account relative" ref={menu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
          <button ref={trigger} className="button-secondary" aria-expanded={open} aria-controls="account-links" onClick={() => setOpen(!open)}>{signedIn ? "My account" : "Get started"} <span aria-hidden="true">⌄</span></button>
          {open && <nav id="account-links" aria-label="Account" className="account-dropdown floating">{!signedIn && links([["/auth/login", "Log in"], ["/auth/register", "Create account"]])}{links(account)}{signedIn && links([["/auth/logout", "Log out"]])}</nav>}
        </div>
        <button ref={mobileTrigger} className="mobile-trigger button-secondary" aria-label="Toggle navigation" aria-controls="mobile-navigation" aria-expanded={mobile} onClick={() => setMobile(!mobile)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={mobile ? "m6 6 12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"}/></svg></button>
      </div>
    </div>
    {mobile && <nav id="mobile-navigation" className="mobile-navigation" aria-label="Mobile navigation">{links(primary)}<div className="nav-divider" />{links(account)}{links(signedIn ? [["/auth/logout", "Log out"]] : [["/auth/login", "Log in"], ["/auth/register", "Create account"]])}</nav>}
  </header>;
}
