/**
 * Next.js App Router helper types.
 *
 * In Next.js 15 the dynamic route segment object passed as the second argument to
 * a route handler is a promise and must be awaited. Reading a segment without
 * the await yields `undefined` and turns an id into `NaN`, so every handler in
 * this project is typed through these aliases and reads its segments with `await
 * context.params`.
 */

/** Awaited dynamic route segments, e.g. `{ hotelId: "42" }`. */
export interface RouteParams {
	[key: string]: string;
}

/** Second handler argument: `{ params }`, where `params` is a promise. */
export interface RouteContext<TParams extends RouteParams = RouteParams> {
	params: Promise<TParams>;
}

/** `app/api/hotels/[hotelId]/route.ts` */
export interface HotelRouteParams extends RouteParams {
	hotelId: string;
}

/** `app/api/hotels/[hotelId]/room-types/[roomTypeId]/route.ts` */
export interface RoomTypeRouteParams extends RouteParams {
	hotelId: string;
	roomTypeId: string;
}

/** `app/api/itineraries/[itineraryId]/route.ts` and its sub-routes. */
export interface ItineraryRouteParams extends RouteParams {
	itineraryId: string;
}

/** `app/api/notifications/[notificationId]/read/route.ts` */
export interface NotificationRouteParams extends RouteParams {
	notificationId: string;
}

/** `app/api/user/flight-bookings/[bookingId]/route.ts` */
export interface FlightBookingRouteParams extends RouteParams {
	bookingId: string;
}

/** `app/api/user/hotel-bookings/[bookingId]/route.ts` */
export interface HotelBookingRouteParams extends RouteParams {
	bookingId: string;
}
