import axios, { AxiosInstance, AxiosResponse, AxiosError } from "axios";

interface City {
    city: string;
    country: string;
}

interface Airport {
    id: string;
    name: string;
    code: string;
    city: string;
    country: string;
}

interface AirlineBase {
    city: string;
    code: string;
    country: string;
    name: string;
}

interface Airline {
    code: string;
    name: string;
    base: AirlineBase;
}

interface FlightSegment {
    id: string;
    airline: { code: string; name: string };
    departureTime: string;
    arrivalTime: string;
    origin: { city: string; code: string; country: string; name: string };
    destination: { city: string; code: string; country: string; name: string };
    price: number;
    currency: string;
    availableSeats: number;
    status: string;
}

interface FlightResult {
    flights: FlightSegment[];
    legs: number;
}

interface BookingData {
    email: string;
    firstName: string;
    lastName: string;
    passportNumber: string;
    flightIds: string[];
}

interface BookingResponse {
    bookingReference: string;
    ticketNumber: string;
    status: string;
    flights: FlightSegment[];
}

interface BookingDetails {
    bookingReference: string;
    status: string;
    flights: FlightSegment[];
    createdAt: string;
}

interface VerificationResponse {
    status: string;
    flights: FlightSegment[];
}

interface ErrorResponse {
    message?: string;
    [key: string]: any;
}

interface AFSClientError {
    status?: number;
    message: string;
    details?: unknown;
}

const afsClient: AxiosInstance = axios.create({
    baseURL: process.env.AFS_BASE_URL,
    headers: {
        "x-api-key": process.env.AFS_API_KEY,
        "Content-Type": "application/json",
    },
});

/**
 * Fetch list of all cities
 * @returns {Promise<City[]>} List of cities
 */
export async function getCities(): Promise<City[]> {
    try {
        const response: AxiosResponse<City[]> = await afsClient.get(
            "/api/cities"
        );
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Failed to fetch cities: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

/**
 * Fetch list of all airports
 * @returns {Promise<Airport[]>} List of airports
 */
export async function getAirports(): Promise<Airport[]> {
    try {
        const response: AxiosResponse<Airport[]> = await afsClient.get(
            "/api/airports"
        );
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Failed to fetch airports: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

/**
 * Fetch list of all airlines
 * @returns {Promise<Airline[]>} List of airlines
 */
export async function getAirlines(): Promise<Airline[]> {
    try {
        const response: AxiosResponse<Airline[]> = await afsClient.get(
            "/api/airlines"
        );
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Failed to fetch airlines: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

interface SearchFlightParams {
    origin: string;
    destination: string;
    date: string; // YYYY-MM-DD
}

/**
 * Search flights
 * @param {SearchFlightParams} params Search parameters
 * @returns {Promise<FlightResult[]>} List of flight results
 */
export async function searchFlights(
    params: SearchFlightParams
): Promise<FlightResult[]> {
    try {
        const response: AxiosResponse<{ results: FlightResult[] }> =
            await afsClient.get("/api/flights", { params });
        return response.data.results;
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Flight search failed: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

/**
 * Create flight booking
 * @param {BookingData} bookingData Booking details
 * @returns {Promise<BookingResponse>} Booking confirmation
 */
export async function createBooking(
    bookingData: BookingData
): Promise<BookingResponse> {
    try {
        const response: AxiosResponse<BookingResponse> = await afsClient.post(
            "/api/bookings",
            bookingData
        );
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Booking failed: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

/**
 * Retrieve booking details
 * @param {string} lastName Passenger's last name
 * @param {string} bookingReference Booking reference number
 * @returns {Promise<BookingDetails>} Booking details
 */
export async function retrieveBooking(
    lastName: string,
    bookingReference: string
): Promise<BookingDetails> {
    try {
        const response: AxiosResponse<BookingDetails> = await afsClient.get(
            "/api/bookings/retrieve",
            {
                params: { lastName, bookingReference },
            }
        );
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Retrieve booking failed: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

/**
 * Verify flight booking status
 * @param {string} bookingReference Booking reference number
 * @param {string} lastName Passenger's last name
 * @returns {Promise<VerificationResponse>} Verification result
 */
export async function verifyFlight(
    bookingReference: string,
    lastName: string
): Promise<VerificationResponse> {
    try {
        const response: AxiosResponse<BookingDetails> = await afsClient.get(
            "/api/bookings/retrieve",
            {
                params: { bookingReference, lastName },
            }
        );
        return {
            status: response.data.status,
            flights: response.data.flights,
        };
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Verification failed: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

/**
 * Cancel flight booking
 * @param {string} bookingReference Booking reference number
 * @param {string} lastName Passenger's last name
 * @returns {Promise<VerificationResponse>} Cancellation result
 */
export async function cancelFlight(
    bookingReference: string,
    lastName: string
): Promise<VerificationResponse> {
    try {
        const response: AxiosResponse<BookingDetails> = await afsClient.post(
            `/api/bookings/cancel`,
            {
                bookingReference,
                lastName,
            }
        );

        return {
            status: response.data.status,
            flights: response.data.flights,
        };
    } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        throw new Error(
            `Cancellation failed: ${
                axiosError.response?.data?.message || axiosError.message
            }`
        );
    }
}

// Add response interceptors for error handling
afsClient.interceptors.response.use(
    (response: AxiosResponse) => response,
    (error: AxiosError<ErrorResponse>) => {
        if (error.response) {
            const status = error.response.status;
            const message = error.response.data?.message || error.message;

            return Promise.reject({
                status,
                message: `AFS API Error (${status}): ${message}`,
                details: error.response.data,
            } as AFSClientError);
        }
        return Promise.reject(error);
    }
);
