"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReservationSuccess from "@/app/components/ReservationSuccess";
import { useRouter } from "next/navigation";
import { sessionFetch, recoverSession } from "@/app/lib/session";
import { bookingRequest, acknowledgeBooking } from "@/app/lib/booking-request";
import { loginUrl } from "@/app/lib/return-path";
import { formatStayDate, stayNights } from "@/app/lib/booking-display";
import { addDays, atMidnight, AVAILABILITY_HORIZON_DAYS, AVAILABILITY_HORIZON_ERROR, isStayWithinAvailabilityHorizon } from "@/lib/api/validation";

interface Room { id: number; name: string; pricePerNight: number; amenities?: string | null }
interface Night { date: string; availability: number }

export default function HotelStayPicker({ hotelId, rooms, roomDetail = false }: { hotelId: string; rooms: Room[]; roomDetail?: boolean }) {
 const router = useRouter();
 const [checkIn, setCheckIn] = useState("");
 const [checkOut, setCheckOut] = useState("");
 const [selected, setSelected] = useState("");
 const [calendars, setCalendars] = useState<Record<number, Night[]>>({});
 const [error, setError] = useState("");
 const [loading, setLoading] = useState(true);
 const [booking, setBooking] = useState(false);
 const [reservation, setReservation] = useState<{id:number;checkIn:string;checkOut:string} | null>(null);
 const version = useRef(0);
 const bookingInFlight = useRef(false);
 const ids = rooms.map(room => room.id).join(",");
 const load = useCallback(async (signal?: AbortSignal) => {
  const request = ++version.current;
  setLoading(true); setError(""); setSelected("");
  try {
   const entries = await Promise.all(ids.split(",").filter(Boolean).map(async id => {
    const response = await sessionFetch(`/api/hotels/${hotelId}/room-types/${id}`, { signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load availability.");
    return [Number(id), body.availabilityRecords as Night[]] as const;
   }));
   if (request !== version.current || signal?.aborted) return false;
   setCalendars(Object.fromEntries(entries));
   return true;
  } catch (failure) {
   if (request === version.current && !signal?.aborted) setError(failure instanceof Error ? failure.message : "Could not load availability.");
  } finally { if (request === version.current && !signal?.aborted) setLoading(false); }
  return false;
 }, [hotelId, ids]);
 useEffect(() => {
  const query = new URLSearchParams(window.location.search);
  const arrival = query.get("checkIn") ?? ""; const departure = query.get("checkOut") ?? "";
  setCheckIn(arrival); setCheckOut(departure);
  const controller = new AbortController();
  if (arrival && departure && !isStayWithinAvailabilityHorizon(new Date(`${arrival}T00:00:00.000Z`), new Date(`${departure}T00:00:00.000Z`))) {
   setError(AVAILABILITY_HORIZON_ERROR);
   setLoading(false);
   return () => { controller.abort(); };
  }
  void load(controller.signal).then(loaded => {
   if (loaded && !controller.signal.aborted && (stayNights(arrival, departure) ?? 0) > 0) setSelected(`${arrival}/${departure}`);
  });
  return () => { controller.abort(); };
 }, [load]);
 const nights = stayNights(checkIn, checkOut) ?? 0;
 const today = atMidnight(new Date());
 const latestCheckIn = addDays(today, AVAILABILITY_HORIZON_DAYS).toISOString().slice(0, 10);
 const latestCheckOut = addDays(today, AVAILABILITY_HORIZON_DAYS + 1).toISOString().slice(0, 10);
 const query = checkIn && checkOut ? `?${new URLSearchParams({checkIn, checkOut})}` : "";
 const available = (roomId: number) => {
  if (selected !== `${checkIn}/${checkOut}` || nights < 1 || loading || error) return null;
  const rows = (calendars[roomId] ?? []).filter(row => row.date.slice(0,10) >= checkIn && row.date.slice(0,10) < checkOut);
  return rows.length === nights ? Math.min(...rows.map(row => row.availability)) : null;
 };
 const book = async (roomId: number) => {
  if (bookingInFlight.current) return;
  bookingInFlight.current = true;
  const returnPath = `${window.location.pathname}${query}`;
  setBooking(true); setError("");
  const body = {hotelId, roomTypeId: String(roomId), checkIn, checkOut};
  try {
   if (!await recoverSession()) { router.push(loginUrl(returnPath)); return; }
   const response = await bookingRequest("/api/hotels/book", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
   const data = await response.json();
   if (!response.ok) throw new Error(response.status >= 500 ? "The result is unknown. Retry with the same dates or check My Hotel Bookings." : data.error || "Booking failed.");
   setReservation({id:data.reservation.id,checkIn:body.checkIn,checkOut:body.checkOut});
   await acknowledgeBooking("/api/hotels/book", body);
   if (await load()) setSelected(`${body.checkIn}/${body.checkOut}`);
  } catch (failure) { setError(failure instanceof Error ? failure.message : "The result is unknown. Check My Hotel Bookings before starting another booking."); }
  finally { bookingInFlight.current = false; setBooking(false); }
 };
 return <section id="stay-dates" className="mt-8 space-y-4" aria-label="Stay dates and availability">
  <h2 className="text-2xl font-semibold heading">Choose dates & availability</h2>
  <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end" onSubmit={event => {
   event.preventDefault();
   if (nights < 1) { setError("Check-out must be after check-in."); return; }
   if (!isStayWithinAvailabilityHorizon(new Date(`${checkIn}T00:00:00.000Z`), new Date(`${checkOut}T00:00:00.000Z`))) { setError(AVAILABILITY_HORIZON_ERROR); return; }
   router.replace(`${window.location.pathname}${query}`, {scroll:false});
   void load().then(loaded => { if (loaded) setSelected(`${checkIn}/${checkOut}`); });
  }}>
   <label className="label min-w-0">Check-in<input className="field mt-1 w-full min-w-0" type="date" required min={today.toISOString().slice(0, 10)} max={latestCheckIn} value={checkIn} disabled={booking} onChange={event => setCheckIn(event.target.value)} /></label>
   <label className="label min-w-0">Check-out<input className="field mt-1 w-full min-w-0" type="date" required min={checkIn ? addDays(new Date(`${checkIn}T00:00:00Z`), 1).toISOString().slice(0, 10) : addDays(today, 1).toISOString().slice(0, 10)} max={latestCheckOut} value={checkOut} disabled={booking} onChange={event => setCheckOut(event.target.value)} /></label>
   <button className="button-primary" disabled={loading || booking}>Check dates & availability</button>
  </form>
  {loading && <p role="status">Loading availability...</p>}
  {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
  {reservation && <ReservationSuccess kind="stay" reservationId={reservation.id} summary={`${formatStayDate(reservation.checkIn)} to ${formatStayDate(reservation.checkOut)}`} />}
  {rooms.map(room => {
   const count = available(room.id);
   const rate = Math.round((room.pricePerNight + Number.EPSILON) * 100) / 100;
   return <div className="surface p-4 space-y-3" key={room.id}>
    <Link className="font-semibold underline" href={`/hotels/${hotelId}/room-types/${room.id}${query}`}>{room.name}</Link>
    {room.amenities && <p className="muted text-sm">{room.amenities}</p>}
    <p>${rate.toFixed(2)} USD / night{count !== null ? ` · ${nights} ${nights === 1 ? "night" : "nights"} · $${(rate*nights).toFixed(2)} USD · ${count > 0 ? `${count} ${count === 1 ? "room" : "rooms"} available` : "Sold out for these dates"}` : " · Select supported dates and check availability"}</p>
    <button className="button-primary" disabled={count === null || count < 1 || booking} onClick={() => void book(room.id)}>{booking ? "Reserving..." : "Reserve room"}</button>
    <details><summary className="cursor-pointer">Nightly availability calendar</summary><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">{(calendars[room.id] ?? []).map(row => <p className="text-sm" key={row.date}>{row.date.slice(0,10)}: {row.availability} rooms</p>)}</div></details>
   </div>;
  })}
  {roomDetail && <Link className="button-secondary" href={`/hotels/${hotelId}${query}`}>Back to hotel</Link>}
 </section>;
}
