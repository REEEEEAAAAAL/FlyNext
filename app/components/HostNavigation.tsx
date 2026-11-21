import Link from "next/link";

export default function HostNavigation({ hotelHref }: { hotelHref?: string }) {
  return (
    <nav className="host-trail" aria-label="Host navigation">
      <Link href="/hotels/owner">Host workspace</Link>
      {hotelHref && <>
        <span aria-hidden="true">/</span>
        <Link href={hotelHref}>Property &amp; room types</Link>
      </>}
    </nav>
  );
}
