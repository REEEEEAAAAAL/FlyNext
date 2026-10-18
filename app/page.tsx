import Link from "next/link";

export default function HomePage() {
  return <div className="home-page">
    <section className="hero-grid">
      <div className="hero-copy">
        <p className="eyebrow">A little planning. A world of possibility.</p>
        <h1>Your next chapter<br />starts with a trip.</h1>
        <p className="hero-description">Find your flight, discover a place to stay, and bring it all together. One thoughtful space for every part of your journey.</p>
        <div className="flex flex-wrap gap-3 mt-8"><Link className="button-primary" href="/flights">Explore flights →</Link><Link className="button-secondary" href="/hotels">Find a stay</Link></div>
        <p className="mt-6 text-sm muted">A travel booking demo. Real exploration, simulated payments.</p>
      </div>
      <div className="journey-art" aria-label="Illustration of a journey from city to coast" role="img">
        <div className="art-sun" /><div className="art-mountain mountain-back" /><div className="art-mountain mountain-front" />
        <svg viewBox="0 0 500 400" className="art-route" aria-hidden="true"><path d="M60 320 Q100 100 270 180 T440 70" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="7 8" /><circle cx="60" cy="320" r="6" fill="currentColor" /><path d="m420 77 25-22-8 32-7-9-10-1Z" fill="currentColor" /></svg>
        <div className="art-caption"><span className="eyebrow">THE JOURNEY IS YOURS</span><strong>Go somewhere new.</strong><span>Flights. Stays. Everything in place.</span></div><span className="art-coordinate">43° N / 79° W</span>
      </div>
    </section>
    <section className="journey-steps" aria-label="How FlyNext works">
      {[
        ["01", "Find your way", "Compare flight routes and choose a stay for your dates.", "/flights", "Start searching"],
        ["02", "Make it a trip", "Reserve first, then link your flight and hotel in one itinerary.", "/itineraries/new", "Build an itinerary"],
        ["03", "Keep it together", "Review your plans, confirm with DEMO payment, and download a receipt.", "/itineraries", "View my trips"],
      ].map(([number, title, copy, href, action]) => <Link className="step-card" href={href} key={number}><span className="step-number">{number}</span><h2>{title}</h2><p>{copy}</p><span className="step-action">{action} →</span></Link>)}
    </section>
    <section className="host-banner"><div><p className="eyebrow">A SPACE FOR HOSTS, TOO</p><h2>Great stays start with you.</h2><p className="muted">Manage your properties, room availability and guest reservations.</p></div><Link className="button-secondary" href="/hotels/owner">Open host workspace</Link></section>
  </div>;
}
