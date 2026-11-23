"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const HOTEL_MANAGEMENT_PATH = /^\/hotels\/(?:owner|new|[^/]+\/(?:edit|room-types\/(?:new|[^/]+\/edit)))\/?$/;

/** Omits the footer shortcut where the home banner or host workflow already provides it. */
export default function FooterHostLink() {
  const pathname = usePathname();
  if (pathname === "/" || HOTEL_MANAGEMENT_PATH.test(pathname)) return null;

  return (
    <>
      <Link href="/hotels/owner">Host workspace</Link>
      <span className="site-footer-divider" aria-hidden="true" />
    </>
  );
}
