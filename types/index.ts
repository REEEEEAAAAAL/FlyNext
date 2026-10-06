/**
 * Barrel for the shared type layer.
 *
 * Everything here is type-only and therefore erased at compile time, so
 * importing from `@/types` never pulls runtime code into a bundle.
 */

export type {
	ApiErrorBody,
	ApiMessageBody,
	ErrorResponse,
	MessageResponse,
	QueryValue,
	HttpMethod,
	JsonValue,
	JsonPrimitive,
} from "./api";
export type {
	TokenClaims,
	AuthContext,
	AuthResult,
	RefreshCookieOptions,
} from "./auth";
export type {
	RouteParams,
	RouteContext,
	HotelRouteParams,
	RoomTypeRouteParams,
	ItineraryRouteParams,
	NotificationRouteParams,
	FlightBookingRouteParams,
	HotelBookingRouteParams,
} from "./next";
export type {
	AfsAirport,
	AfsAirline,
	AfsFlight,
	AfsFlightGroup,
	AfsFlightSearchResponse,
	AfsFlightSearchParams,
	AfsCity,
	AfsCreateBookingRequest,
	AfsBooking,
	AfsRetrievedBooking,
	AfsBookingStatus,
} from "./afs";
export type {
	UserProfile,
	RoomTypeSummary,
	HotelWithRoomTypes,
	AvailabilityRecordDto,
	RoomTypeReservationDto,
	FlightSegmentJson,
	FlightLegJson,
	FlightSegmentDto,
	FlightLegDto,
	FlightBookingListItem,
	FlightBookingDetail,
	HotelBookingListItem,
	HotelBookingDetail,
	ItineraryListItem,
	ItineraryDetail,
	LoginResponse,
	RefreshResponse,
	NotificationDto,
	CityDto,
	AirportDto,
} from "./models";
