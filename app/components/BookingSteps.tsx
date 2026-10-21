import Link from "next/link";

export default function BookingSteps({ current }: { current: "reserve" | "plan" | "confirm" }) {
  return <nav className="flow-banner" aria-label="Booking progress">
    <span className="reserve-step" aria-current={current === "reserve" ? "step" : undefined}><span>1. Reserve</span><Link href="/flights">Flights</Link><span aria-hidden="true">/</span><Link href="/hotels">Stays</Link></span>
    <Link href="/itineraries/new" aria-current={current === "plan" ? "step" : undefined}>2. Build an itinerary</Link>
    <span aria-current={current === "confirm" ? "step" : undefined}>3. Review & confirm DEMO</span>
  </nav>;
}
