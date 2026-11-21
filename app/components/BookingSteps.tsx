import Link from "next/link";

export default function BookingSteps({ current }: { current: "reserve" | "plan" | "confirm" }) {
  return (
    <nav className="flow-banner" aria-label="Booking progress">
      <ol>
        <li aria-current={current === "reserve" ? "step" : undefined}>
          <span className="flow-number" aria-hidden="true">1</span>
          <div>
            Reserve
            <span className="flow-destinations">
              <Link href="/flights">Flights</Link>
              <span aria-hidden="true">/</span>
              <Link href="/hotels">Stays</Link>
            </span>
          </div>
        </li>
        <li aria-current={current === "plan" ? "step" : undefined}>
          <span className="flow-number" aria-hidden="true">2</span>
          <Link href="/itineraries/new">Build an itinerary</Link>
        </li>
        <li aria-current={current === "confirm" ? "step" : undefined}>
          <span className="flow-number" aria-hidden="true">3</span>
          <span>Review &amp; confirm DEMO</span>
        </li>
      </ol>
    </nav>
  );
}
