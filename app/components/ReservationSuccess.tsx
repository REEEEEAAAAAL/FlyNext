"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function ReservationSuccess({ kind, reservationId, summary }: { kind: "flight" | "stay"; reservationId: number; summary: string }) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
    card.current?.scrollIntoView({ block: "nearest" });
  }, [reservationId]);
  return <section ref={card} role="status" tabIndex={-1} aria-label="Reservation confirmed" className="reservation-success surface">
    <div><p className="font-semibold reservation-success-title">Your {kind} is reserved</p><p className="muted text-sm mt-1">Reservation #{reservationId} · {summary}</p></div>
    <div className="reservation-success-actions"><Link className="button-primary" href="/itineraries/new">Build an itinerary</Link><Link className="button-secondary" href={`/user/${kind === "flight" ? "flight" : "hotel"}-bookings/${reservationId}`}>View reservation</Link></div>
  </section>;
}
