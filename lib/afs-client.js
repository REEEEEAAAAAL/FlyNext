const axios = require("axios");

const afsClient = axios.create({
    baseURL: process.env.AFS_BASE_URL,
    headers: {
        "x-api-key": process.env.AFS_API_KEY,
        "Content-Type": "application/json",
    },
});

/**
 * Fetch list of all cities
 * @returns {Promise<Array<{city: string, country: string}>>}
 */
export async function getCities() {
    try {
        const response = await afsClient.get("/api/cities");
        return response.data;
    } catch (error) {
        throw new Error(
            `Failed to fetch cities: ${
                error.response?.data?.message || error.message
            }`
        );
    }
}

/**
 * Fetch list of all airports
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   code: string,
 *   city: string,
 *   country: string
 * }>>}
 */
export async function getAirports() {
    try {
        const response = await afsClient.get("/api/airports");
        return response.data;
    } catch (error) {
        throw new Error(
            `Failed to fetch airports: ${
                error.response?.data?.message || error.message
            }`
        );
    }
}

/**
 * Fetch list of all airlines
 * @returns {Promise<Array<{
 *   code: string,
 *   name: string,
 *   base: {
 *     city: string,
 *     code: string,
 *     country: string,
 *     name: string
 *   }
 * }>>}
 */
export async function getAirlines() {
    try {
        const response = await afsClient.get("/api/airlines");
        return response.data;
    } catch (error) {
        throw new Error(
            `Failed to fetch airlines: ${
                error.response?.data?.message || error.message
            }`
        );
    }
}

/**
 * Search flights
 * @param {Object} params
 * @param {string} params.origin
 * @param {string} params.destination
 * @param {string} params.date (YYYY-MM-DD)
 * @returns {Promise<Array<{
 *   flights: Array<{
 *     id: string,
 *     airline: {code: string, name: string},
 *     departureTime: string,
 *     arrivalTime: string,
 *     origin: {city: string, code: string, country: string, name: string},
 *     destination: {city: string, code: string, country: string, name: string},
 *     price: number,
 *     currency: string,
 *     availableSeats: number,
 *     status: string
 *   }>,
 *   legs: number
 * }>>}
 */
export async function searchFlights(params) {
    try {
        const response = await afsClient.get("/api/flights", { params });
        return response.data.results;
    } catch (error) {
        throw new Error(
            `Flight search failed: ${
                error.response?.data?.message || error.message
            }`
        );
    }
}

/**
 * Create flight booking
 * @param {Object} bookingData
 * @param {string} bookingData.email
 * @param {string} bookingData.firstName
 * @param {string} bookingData.lastName
 * @param {string} bookingData.passportNumber
 * @param {Array<string>} bookingData.flightIds
 * @returns {Promise<{
 *   bookingReference: string,
 *   ticketNumber: string,
 *   status: string,
 *   flights: Array<Object>
 * }>}
 */
export async function createBooking(bookingData) {
    try {
        const response = await afsClient.post("/api/bookings", bookingData);
        return response.data;
    } catch (error) {
        throw new Error(
            `Booking failed: ${error.response?.data?.message || error.message}`
        );
    }
}
/**
 * Retrieve booking details
 * @param {string} lastName
 * @param {string} bookingReference
 * @returns {Promise<{
 *   bookingReference: string,
 *   status: string,
 *   flights: Array<Object>,
 *   createdAt: string
 * }>}
 */
export async function retrieveBooking(lastName, bookingReference) {
    try {
        const response = await afsClient.get("/api/bookings/retrieve", {
            params: { lastName, bookingReference },
        });
        return response.data;
    } catch (error) {
        throw new Error(
            `Retrieve booking failed: ${
                error.response?.data?.message || error.message
            }`
        );
    }
}

/**
 * Verify flight booking status
 * @param {string} bookingReference
 * @param {string} lastName
 * @returns {Promise<{status: string, flights: Array}>}
 */
export async function verifyFlight(bookingReference, lastName) {
    try {
        const response = await afsClient.get("/api/bookings/retrieve", {
            params: {
                bookingReference,
                lastName,
            },
        });
        return {
            status: response.data.status,
            flights: response.data.flights,
        };
    } catch (error) {
        throw new Error(
            `Verification failed: ${
                error.response?.data?.message || error.message
            }`
        );
    }
}

/**
 * Cancel flight booking
 * @param {string} bookingReference
 * @param {string} lastName
 * @returns {Promise<{status: string, flights: Array}>}
 */
export async function cancelFlight(bookingReference, lastName) {
    try {
        const response = await afsClient.post(`/api/bookings/cancel`, {
            bookingReference,
            lastName,
        });

        return {
            status: response.data.status,
            flights: response.data.flights,
        };
    } catch (error) {
        throw new Error(
            `Cancellation failed: ${
                error.response?.data?.message || error.message
            }`
        );
    }
}

// Add response interceptors for error handling
afsClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response) {
            const status = error.response.status;
            const message = error.response.data?.message || "Unknown error";

            return Promise.reject({
                status,
                message: `AFS API Error (${status}): ${message}`,
                details: error.response.data,
            });
        }
        return Promise.reject(error);
    }
);
