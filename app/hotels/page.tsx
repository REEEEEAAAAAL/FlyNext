"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LocationCombobox from "@/app/components/LocationCombobox";
import BookingSteps from "@/app/components/BookingSteps";
import ReservationSuccess from "@/app/components/ReservationSuccess";
import { acknowledgeBooking, bookingRequest } from "@/app/lib/booking-request";
import { sessionFetch, recoverSession } from "@/app/lib/session";
import { loginUrl } from "@/app/lib/return-path";
import { formatStayDate, stayNights } from "@/app/lib/booking-display";
import { EMPTY_HOTEL_SEARCH, hotelCheckoutMin, hotelSearchParams, hotelSearchPath, readHotelSearch, validateHotelSearch, type HotelSearch } from "@/app/lib/hotel-search";
import { useFeedback } from "@/app/context/FeedbackContext";
import { addDays, atMidnight, AVAILABILITY_HORIZON_DAYS } from "@/lib/api/validation";

interface RoomType {
  id: number;
  name: string;
  amenities: string | null;
  pricePerNight: number;
  availableRooms?: number | null;
  stayTotal?: number | null;
}
interface Hotel {
  id: number;
  name: string;
  address: string;
  location: string;
  starRating: number;
  images?: string[];
  roomTypes: RoomType[];
}

export default function HotelSearchPage() {
  const router = useRouter();
  const { error: toastError } = useFeedback();
  const [draft, setDraft] = useState<HotelSearch>(EMPTY_HOTEL_SEARCH);
  const [applied, setApplied] = useState<HotelSearch>(EMPTY_HOTEL_SEARCH);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingRoom, setPendingRoom] = useState("");
  const [bookedRoom, setBookedRoom] = useState("");
  const [bookingFailure, setBookingFailure] = useState("");
  const [reservation, setReservation] = useState<{id:number;summary:string} | null>(null);
  const searchVersion = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const lastRequest = useRef<HotelSearch>(EMPTY_HOTEL_SEARCH);
  const bookingInFlight = useRef(false);

  const loadHotels = useCallback(async (search: HotelSearch) => {
    const version = ++searchVersion.current;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    lastRequest.current = search;
    setError(""); setCanRetry(false); setLoading(true);
    const invalid = validateHotelSearch(search);
    if (invalid) { setError(invalid); setLoading(false); return; }
    try {
      const response = await sessionFetch(`/api/hotels?${hotelSearchParams(search)}`, {signal:controller.signal});
      const data: {hotels?:Hotel[];error?:string} = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load stays. Please try again.");
      if (version !== searchVersion.current || controller.signal.aborted) return;
      setHotels(data.hotels ?? []); setApplied(search);
    } catch (failure) {
      if (version === searchVersion.current && !controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Could not load stays."); setCanRetry(true); }
    } finally {
      if (version === searchVersion.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const restore = () => {
      const search = readHotelSearch(new URLSearchParams(window.location.search));
      setDraft(search); setBookedRoom("");
      void loadHotels(search);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => { window.removeEventListener("popstate", restore); searchVersion.current += 1; searchController.current?.abort(); };
  }, [loadHotels]);

  const applySearch = (search: HotelSearch) => {
    const invalid = validateHotelSearch(search);
    if (invalid) { searchVersion.current++; searchController.current?.abort(); setLoading(false); setCanRetry(false); setError(invalid); return; }
    const path = hotelSearchPath(search);
    if (path !== window.location.pathname + window.location.search) window.history.pushState(null, "", path);
    setDraft(search); setBookedRoom("");
    void loadHotels(search);
  };
  const clearFilters = () => applySearch({...draft,name:"",starRating:"",priceMin:"",priceMax:""});
  const chooseDates = () => { document.getElementById(draft.checkIn && !draft.checkOut ? "check-out" : "check-in")?.focus(); };
  const dirty = hotelSearchParams(draft).toString() !== hotelSearchParams(applied).toString();
  const nights = stayNights(draft.checkIn, draft.checkOut) ?? 0;
  const hasFilters = Boolean(draft.name || draft.starRating || draft.priceMin || draft.priceMax);
  const today = atMidnight(new Date());
  const earliest = today.toISOString().slice(0,10);
  const latestCheckIn = addDays(today,AVAILABILITY_HORIZON_DAYS).toISOString().slice(0,10);
  const latestCheckOut = addDays(today,AVAILABILITY_HORIZON_DAYS+1).toISOString().slice(0,10);
  const detailQuery = draft.checkIn && draft.checkOut && !validateHotelSearch(draft) ? `?${new URLSearchParams({checkIn:draft.checkIn,checkOut:draft.checkOut})}` : "";

  const bookRoom = async (hotel: Hotel, room: RoomType) => {
    if (bookingInFlight.current || dirty || loading || error || !applied.checkIn || !applied.checkOut) return;
    bookingInFlight.current = true;
    const search = applied;
    const key = `${hotel.id}-${room.id}/${search.checkIn}/${search.checkOut}`;
    const version = searchVersion.current;
    const body = {hotelId:String(hotel.id),roomTypeId:String(room.id),checkIn:search.checkIn,checkOut:search.checkOut};
    setPendingRoom(key); setBookingFailure("");
    try {
      if (!await recoverSession()) { router.push(loginUrl(hotelSearchPath(search))); return; }
      const response = await bookingRequest("/api/hotels/book",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data = await response.json();
      if (!response.ok) throw new Error(response.status >= 500 ? "The result is unknown. Retry with the same dates or check My Hotel Bookings before starting a new booking." : data.error || "Booking failed.");
      setReservation({id:data.reservation.id,summary:`${formatStayDate(search.checkIn)} to ${formatStayDate(search.checkOut)}`});
      setBookedRoom(key);
      await acknowledgeBooking("/api/hotels/book",body);
      if (version === searchVersion.current) await loadHotels(search);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "The result is unknown. Retry with the same dates or check My Hotel Bookings.";
      setBookingFailure(message); toastError("Booking failed",{description:message});
    } finally { bookingInFlight.current = false; setPendingRoom(""); }
  };

  return <div className="page-shell card">
    <BookingSteps current="reserve" />
    <h1 className="text-3xl font-bold mb-6 heading">Find your place to stay</h1>
    <p className="search-intro">Compare rooms, nightly rates and stay totals in USD.</p>
    <form onSubmit={event => {event.preventDefault();applySearch(draft);}} className="search-form mb-8">
      <fieldset disabled={Boolean(pendingRoom)} className="hotel-search-fields">
        <legend className="sr-only">Hotel search</legend>
        <LocationCombobox label="Destination" kind="cities" value={draft.city} onChange={city=>setDraft({...draft,city})} placeholder="Any destination" required={false} disabled={Boolean(pendingRoom)} />
        <div><label htmlFor="check-in" className="label">Check-in:</label><input id="check-in" type="date" className="field" value={draft.checkIn} min={earliest} max={latestCheckIn} required={Boolean(draft.checkOut)} onChange={event=>setDraft({...draft,checkIn:event.target.value})} /></div>
        <div><label htmlFor="check-out" className="label">Check-out:</label><input id="check-out" type="date" className="field" value={draft.checkOut} min={hotelCheckoutMin(draft.checkIn, today)} max={latestCheckOut} required={Boolean(draft.checkIn)} onChange={event=>setDraft({...draft,checkOut:event.target.value})} /></div>
        <details className="hotel-search-filters"><summary className="text-sm font-semibold cursor-pointer text-blue-600 dark:text-blue-300">Refine your stay</summary><div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div><label className="label" htmlFor="hotel-name-filter">Hotel name</label><input className="field" id="hotel-name-filter" value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})} placeholder="Any hotel" /></div>
          <div><label className="label" htmlFor="hotel-rating-filter">Star rating</label><select className="field" id="hotel-rating-filter" value={draft.starRating} onChange={event=>setDraft({...draft,starRating:event.target.value})}><option value="">Any rating</option>{[1,2,3,4,5].map(rating=><option key={rating} value={rating}>{rating} stars</option>)}</select></div>
          <div><label className="label" htmlFor="hotel-min-price">Minimum nightly rate (USD)</label><input className="field" id="hotel-min-price" type="number" min="0" step="0.01" value={draft.priceMin} onChange={event=>setDraft({...draft,priceMin:event.target.value})} placeholder="No minimum" /></div>
          <div><label className="label" htmlFor="hotel-max-price">Maximum nightly rate (USD)</label><input className="field" id="hotel-max-price" type="number" min="0" step="0.01" value={draft.priceMax} onChange={event=>setDraft({...draft,priceMax:event.target.value})} placeholder="No maximum" /></div>
        </div></details>
        <div className="hotel-search-actions"><button type="submit" className="button-primary" disabled={loading}>{loading ? "Searching stays…" : "Search stays"}</button><button type="button" className="button-secondary" onClick={()=>applySearch(EMPTY_HOTEL_SEARCH)}>Show All</button>{hasFilters && <button type="button" className="text-sm underline muted" onClick={clearFilters}>Clear filters</button>}</div>
      </fieldset>
    </form>
    {reservation && <ReservationSuccess kind="stay" reservationId={reservation.id} summary={reservation.summary} />}
    {bookingFailure && <p role="alert" className="text-red-600 dark:text-red-400 mb-4">{bookingFailure}</p>}
    {error && <div role="alert" className="surface p-5 mb-6"><p className="text-red-600 dark:text-red-400">{error}</p>{canRetry && <button type="button" className="button-secondary mt-3" disabled={Boolean(pendingRoom)} onClick={()=>{setDraft(lastRequest.current);void loadHotels(lastRequest.current);}}>Retry search</button>}</div>}
    <section aria-label="Hotel results" aria-busy={loading}>
      <div className="hotel-results-heading">
        <div><h2 className="text-2xl font-semibold heading">{applied.checkIn ? "Available stays" : "Browse hotels"}</h2><p className="muted text-sm mt-1">{applied.city || "All destinations"}{applied.checkIn && ` · ${formatStayDate(applied.checkIn)} to ${formatStayDate(applied.checkOut)}`}{` · ${hotels.length} ${hotels.length === 1 ? "property" : "properties"}`}{applied.priceMin && ` · From $${applied.priceMin}/night`}{applied.priceMax && ` · Up to $${applied.priceMax}/night`}</p></div>
        {dirty && !loading && <button type="button" className="button-secondary" disabled={Boolean(pendingRoom)} onClick={()=>applySearch(draft)}>Update results</button>}
      </div>
      {loading && <p role="status" className="muted mb-4">{hotels.length ? "Updating stays…" : "Loading hotels…"}</p>}
      <ul className={`space-y-6${loading ? " opacity-60" : ""}`}>
        {hotels.map(hotel=><li key={hotel.id} className="surface p-5 sm:p-6">
          {hotel.images?.[0] && <img src={hotel.images[0]} alt={hotel.name} loading="lazy" className="w-full h-48 sm:h-64 object-cover rounded-xl mb-5" />}
          <div className="flex flex-wrap gap-4 justify-between items-start"><div><h3 className="text-xl font-semibold heading">{hotel.name}</h3><p className="muted text-sm mt-1">{hotel.address}</p><p className="muted text-sm">{hotel.location}</p></div><span className="text-yellow-600 dark:text-yellow-400" aria-label={`${hotel.starRating} stars`}>{"★".repeat(hotel.starRating)}</span></div>
          <div className="mt-4 space-y-3">{hotel.roomTypes.map(room=>{
            const key = `${hotel.id}-${room.id}/${applied.checkIn}/${applied.checkOut}`;
            const available = !dirty && !loading && !error && applied.checkIn ? room.availableRooms : null;
            const pending = pendingRoom === key;
            const booked = bookedRoom === key;
            return <div className="hotel-room-option" key={room.id}>
              <div className="min-w-0"><h4 className="font-semibold heading">{room.name}</h4>{room.amenities && <p className="muted text-sm mt-1">{room.amenities}</p>}{available != null && <p className="text-sm mt-2">{available} {available === 1 ? "room" : "rooms"} available for your stay</p>}</div>
              <div className="hotel-room-price"><p className="font-bold text-lg heading">${room.pricePerNight.toFixed(2)} <span className="text-sm font-normal muted">USD / night</span></p>{nights > 0 && <p className="muted text-sm">{available == null ? "Estimated " : ""}${(available == null ? room.pricePerNight*nights : room.stayTotal ?? room.pricePerNight*nights).toFixed(2)} USD · {nights} {nights === 1 ? "night" : "nights"}</p>}
              <button type="button" className="button-primary mt-3" disabled={loading || Boolean(pendingRoom) || booked || (available != null && available < 1)} onClick={()=>{if (!draft.checkIn || !draft.checkOut) chooseDates();else if (available == null) applySearch(draft);else void bookRoom(hotel,room);}}>{pending ? "Reserving…" : booked ? "Booked" : !draft.checkIn || !draft.checkOut ? "Choose dates" : available == null ? "Check availability" : available < 1 ? "Unavailable" : "Book Now"}</button></div>
            </div>;
          })}{hotel.roomTypes.length === 0 && <p className="muted text-sm">No room types available.</p>}</div>
          <Link className="inline-block text-sm underline mt-4" href={`/hotels/${hotel.id}${detailQuery}`}>View Details</Link>
        </li>)}
      </ul>
      {!loading && !error && hotels.length === 0 && <div className="surface p-8 text-center"><h3 className="text-xl font-semibold heading">No stays match your search</h3><div className="flex flex-wrap justify-center gap-3 mt-5">{hasFilters && <button type="button" className="button-primary" onClick={clearFilters}>Clear filters</button>}{draft.checkIn && <button type="button" className="button-secondary" onClick={chooseDates}>Change dates</button>}<button type="button" className="button-secondary" onClick={()=>applySearch(EMPTY_HOTEL_SEARCH)}>Browse all hotels</button></div></div>}
    </section>
  </div>;
}
