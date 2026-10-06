/**
 * Domain models and response DTOs.
 *
 * Where a handler returns a Prisma row untouched, the Prisma generated type is
 * used directly (`Prisma.HotelGetPayload<…>`). The interfaces below describe the
 * projected shapes this API actually serialises, which the browser client
 * reads field-by-field.
 */

import type { BookingStatus } from "@prisma/client";
import type { JsonValue } from "./api";

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

/** `GET /api/user` — `{ user }`. Field names match the Prisma column names. */
export interface UserProfile {
	id: number;
	email: string;
	firstName: string;
	lastName: string;
	/** Falls back to `"/user-profile-default.svg"` when the user has no upload. */
	profilePic: string;
	phone: string | null;
	/** Capital `I` — the browser client compares this with `=== false`. */
	IsHotelOwner: boolean;
}

/* -------------------------------------------------------------------------- */
/* Hotels and room types                                                      */
/* -------------------------------------------------------------------------- */

/** A room type as embedded in hotel payloads. */
export interface RoomTypeSummary {
	id: number;
	name: string;
	amenities: string | null;
	pricePerNight: number;
	images: JsonValue;
	currentAvailability: number;
	hotelId: number;
}

/** A hotel plus its room types — `GET /api/hotels`, `GET /api/hotels/[hotelId]`. */
export interface HotelWithRoomTypes {
	id: number;
	name: string;
	logo: string;
	address: string;
	location: string;
	starRating: number;
	images: JsonValue;
	ownerId: number | null;
	roomTypes: RoomTypeSummary[];
}

/** A single date's availability row, charted by the room-type edit page. */
export interface AvailabilityRecordDto {
	id: number;
	date: Date;
	availability: number;
	roomTypeId: number;
}

/**
 * A hotel reservation as surfaced to the hotel owner on the room-type edit
 * page. `guestName` is synthesised from the related user, because the client
 * renders it directly.
 */
export interface RoomTypeReservationDto {
	id: number;
	userId: number;
	checkIn: Date;
	checkOut: Date;
	price: number;
	status: BookingStatus;
	guestName: string;
}

/* -------------------------------------------------------------------------- */
/* Flight reservation JSON columns                                            */
/* -------------------------------------------------------------------------- */

/**
 * One flight of a booked direction: a single take-off and landing.
 *
 * A direction is flown in one leg or several — `YYZ→HKG→CAN` is two — and this is
 * what carries the connection. The four summary values on {@link FlightLegJson}
 * name only where a direction began and where it ended, so without these the
 * transfer airport is invisible.
 */
export type FlightSegmentJson = {
	from: string | null;
	to: string | null;
	departDate: string | null;
	arriveDate: string | null;
};

/**
 * Shape stored in `FlightReservation.departure` / `.arrival`.
 *
 * The columns are Prisma `Json`, so they arrive typed as `JsonValue` and must be
 * narrowed. Each holds one value per direction flown — the `go*` pair for the
 * outbound direction and the `return*` pair for the way home — where the
 * `departure` column carries the direction's first leg (where it left from, and
 * when) and the `arrival` column its last leg (where it landed, and when). A
 * journey with a connection is therefore one direction, not two: `YYZ→HKG→CAN`
 * is stored as leaving YYZ and landing at CAN, with the Hong Kong transfer in
 * `goLegs`. `null` marks "no return direction" on write; see `buildFlightLegs` in
 * `lib/reservations.ts`.
 *
 * `goLegs` / `returnLegs` are optional because a row written before the legs were
 * recorded has only the summary values. Callers read them through
 * `toFlightLegDto`, which turns an absent list into an empty one.
 *
 * Declared as a type alias rather than an interface on purpose: only type aliases
 * receive an implicit index signature, which is what makes the value assignable
 * to Prisma's `InputJsonValue` when writing the column.
 */
export type FlightLegJson = {
	goDate: string | null;
	goAirport: string | null;
	returnDate: string | null;
	returnAirport: string | null;
	goLegs?: FlightSegmentJson[];
	returnLegs?: FlightSegmentJson[];
};

/**
 * One flight of a direction, as the booking-history endpoints serialise it.
 *
 * Every field is a string, like {@link FlightLegDto}: an absent value becomes the
 * single-space sentinel `" "`, so a page can render a partially known leg without
 * testing for `null` and `undefined` separately.
 */
export interface FlightSegmentDto {
	from: string;
	to: string;
	departDate: string;
	arriveDate: string;
}

/**
 * Shape returned by the booking-history endpoints.
 *
 * Every field is a string: an absent value is normalised to the single-space
 * sentinel `" "`, which both booking pages test against and which
 * `formatDate()` maps to `"N/A"`. The four summary values describe the two
 * directions flown — see {@link FlightLegJson} — and a one-way booking leaves the
 * `return*` pair at the sentinel, which is what stops a second card being
 * rendered.
 *
 * `goLegs` / `returnLegs` are the flights each direction is made of, in order;
 * more than one entry means the direction has a connection, and the airports
 * between the first and last are the transfers. They are empty for a row written
 * before the legs were recorded, which is why a page must still be able to render
 * a direction from the summary values alone.
 */
export interface FlightLegDto {
	goDate: string;
	goAirport: string;
	returnDate: string;
	returnAirport: string;
	goLegs: FlightSegmentDto[];
	returnLegs: FlightSegmentDto[];
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/user/flight-bookings` — one list item.
 *
 * `itineraryId` is part of the payload because `app/itineraries/new/page.tsx`
 * filters on `!booking.itineraryId` to decide which bookings are still linkable.
 */
export interface FlightBookingListItem {
	id: number;
	status: BookingStatus;
	afsBookingId: string;
	price: number;
	departure: FlightLegDto;
	arrival: FlightLegDto;
	itineraryId: number | null;
	createdAt: Date;
}

/** `GET /api/user/flight-bookings/[bookingId]` — `{ booking }`. */
export type FlightBookingDetail = FlightBookingListItem;

/**
 * `GET /api/user/hotel-bookings` — one list item.
 *
 * Note the nested `period` envelope: the list endpoint nests the stay dates
 * while the detail endpoint returns them flat. Both are load-bearing for the
 * client and must not be unified.
 *
 * `hotel` and `roomType` are nullable because both foreign keys are
 * `onDelete: SetNull`. The client dereferences `b.hotel.name` directly, so the
 * handler substitutes a placeholder rather than letting the list endpoint throw.
 */
export interface HotelBookingListItem {
	id: number;
	status: BookingStatus;
	itineraryId: number | null;
	period: {
		checkIn: Date;
		checkOut: Date;
	};
	hotel: {
		name: string;
		address: string;
		location: string;
	};
	roomType: {
		name: string;
		amenities: string | null;
	} | null;
	totalPrice: number;
	createdAt: Date;
}

/** `GET /api/user/hotel-bookings/[bookingId]` — `{ booking }`. */
export interface HotelBookingDetail {
	id: number;
	status: BookingStatus;
	checkIn: Date;
	checkOut: Date;
	price: number;
	hotel: {
		name: string;
		address: string;
		location: string;
	};
	/** `type` is null when the room type has been deleted. */
	room: {
		type: string | null;
		amenities: string | null;
	};
	createdAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Itineraries                                                                */
/* -------------------------------------------------------------------------- */

/** `GET /api/itineraries` — one list item. */
export interface ItineraryListItem {
	id: number;
	flight: {
		id: number;
		departure: JsonValue;
		arrival: JsonValue;
		price: number;
		status: BookingStatus;
	} | null;
	hotel: {
		hotel: { name: string; address: string; location: string } | null;
		roomType: { name: string } | null;
		checkIn: Date;
		checkOut: Date;
		price: number;
		status: BookingStatus;
	} | null;
	totalPrice: number;
	bookingDate: Date;
	status: BookingStatus;
}

/**
 * `GET /api/itineraries/[itineraryId]`.
 *
 * IMPORTANT: this endpoint returns the itinerary as the bare response body —
 * it is not wrapped in an `{ itinerary }` envelope. Three client components
 * assign the parsed body straight into state.
 */
export interface ItineraryDetail {
	id: number;
	flight: {
		id: number;
		departure: JsonValue;
		arrival: JsonValue;
		price: number;
		status: BookingStatus;
	} | null;
	hotel: {
		id: number;
		hotel: { name: string; address: string; location: string } | null;
		roomType: { name: string } | null;
		checkIn: Date;
		checkOut: Date;
		price: number;
		status: BookingStatus;
	} | null;
	totalPrice: number;
	bookingDate: Date;
	status: BookingStatus;
}

/* -------------------------------------------------------------------------- */
/* Authentication payloads                                                    */
/* -------------------------------------------------------------------------- */

/** `POST /api/auth/login` — success body. */
export interface LoginResponse {
	message: string;
	accessToken: string;
}

/** `POST /api/auth/refresh` — success body. */
export interface RefreshResponse {
	accessToken: string;
}

/* -------------------------------------------------------------------------- */
/* Notifications, cities and airports                                         */
/* -------------------------------------------------------------------------- */

/** `GET /api/notifications` — one list item. */
export interface NotificationDto {
	id: number;
	userId: number;
	content: string;
	isRead: boolean;
	createdAt: Date;
}

/** `GET /api/locations/cities` — one list item. */
export interface CityDto {
	id: number;
	name: string;
	country: string;
}

/** `GET /api/locations/airports` — one list item. */
export interface AirportDto {
	id: number;
	externalId: string;
	code: string;
	name: string;
	country: string;
	cityId: number | null;
}
