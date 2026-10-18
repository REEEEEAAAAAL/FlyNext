import Link from "next/link";

export default function BookingSteps({ current }: { current: "reserve" | "plan" | "confirm" }) {
  return <nav className="flow-banner" aria-label="Booking progress">
    <Link href="/flights" aria-current={current === "reserve" ? "step" : undefined}>1. Reserve flights & stays</Link>
    <Link href="/itineraries/new" aria-current={current === "plan" ? "step" : undefined}>2. Build an itinerary</Link>
    <span aria-current={current === "confirm" ? "step" : undefined}>3. Review & confirm DEMO</span>
  </nav>;
}
