/**
 * Error taxonomy for the FlyNext HTTP API.
 *
 * Every handler reports failures by throwing an {@link ApiError}. The single
 * error boundary in `lib/api/handler.ts` turns it into the JSON envelope the
 * browser client expects (`{ error: string }`), so no route needs its own
 * `try`/`catch` just to shape a response.
 *
 * A real `Error` subclass is used rather than a rejected bare object, so stack
 * traces survive into the server log and `instanceof` checks are reliable — which
 * is what lets the boundary distinguish an expected `404` from a genuine fault
 * without inspecting messages.
 */

/** An error that maps directly onto an HTTP status code and a JSON body. */
export class ApiError extends Error {
	/** HTTP status code to return. */
	readonly status: number;

	/** Optional, non-sensitive extra context included in the response body. */
	readonly details?: string;

	/**
	 * Response headers the error requires.
	 *
	 * Empty for almost every error. It exists for `429`, where the status is
	 * meaningless to a client without `Retry-After`.
	 */
	readonly headers: Headers;

	constructor(status: number, message: string, details?: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.headers = new Headers();
		if (details !== undefined) {
			this.details = details;
		}
		// Restore the prototype chain: required when a subclass of `Error` is
		// transpiled down to ES5, and harmless on modern targets.
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/** `400 Bad Request` — the caller sent something unusable. */
export function badRequest(message: string, details?: string): ApiError {
	return new ApiError(400, message, details);
}

/** `401 Unauthorized` — no usable access token. */
export function unauthorized(message = "Unauthorized"): ApiError {
	return new ApiError(401, message);
}

/** `403 Forbidden` — authenticated, but not allowed to touch this resource. */
export function forbidden(message = "Operation is forbidden"): ApiError {
	return new ApiError(403, message);
}

/** `404 Not Found`. */
export function notFound(message = "Resource not found"): ApiError {
	return new ApiError(404, message);
}

/** `409 Conflict` — typically a unique-constraint clash. */
export function conflict(message: string): ApiError {
	return new ApiError(409, message);
}

/**
 * `502 Bad Gateway` — an upstream dependency (AFS) failed.
 *
 * Upstream statuses are deliberately not forwarded. The browser client
 * inspects `401` to decide whether the session expired, so relaying an upstream
 * `401` would log the user out because a third party rejected our API key.
 */
export function badGateway(message: string, details?: string): ApiError {
	return new ApiError(502, message, details);
}

/** Narrow an unknown thrown value to a readable message. */
export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Unknown error";
}
