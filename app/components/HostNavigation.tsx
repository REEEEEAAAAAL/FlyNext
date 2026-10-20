import Link from "next/link";

export default function HostNavigation({ hotelHref }: { hotelHref?: string }) {
  return <nav className="flow-banner" aria-label="Host navigation"><Link href="/hotels/owner">Host workspace</Link>{hotelHref && <Link href={hotelHref}>Property & room types</Link>}<span>Manage your listing</span></nav>;
}
