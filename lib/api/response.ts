/**
 * Response helpers.
 *
 * Keeping construction in one place guarantees the JSON envelope stays stable:
 * failures are `{ error }`, action successes are `{ message }`, and every
 * response carries an explicit status code.
 */

import { NextResponse } from "next/server";
import type { ApiErrorBody, ApiMessageBody } from "@/types";

/** `200`/`201` JSON response for an arbitrary payload. */
export function jsonResponse<TBody>(body: TBody, status = 200): NextResponse {
	return NextResponse.json(body, { status });
}

/** `200` JSON response. */
export function jsonOk<TBody>(body: TBody): NextResponse {
	return NextResponse.json(body, { status: 200 });
}

/** `201` JSON response. */
export function jsonCreated<TBody>(body: TBody): NextResponse {
	return NextResponse.json(body, { status: 201 });
}

/** `{ message }` response with a caller-chosen status. */
export function jsonMessage(message: string, status = 200): NextResponse {
	const body: ApiMessageBody = { message };
	return NextResponse.json(body, { status });
}

/** `{ error }` response. */
export function jsonError(
	error: string,
	status: number,
	details?: string,
	headers?: Headers
): NextResponse {
	const body: ApiErrorBody = details === undefined ? { error } : { error, details };
	const response = NextResponse.json(body, { status });
	if (headers !== undefined) {
		headers.forEach((value, key) => {
			response.headers.set(key, value);
		});
	}
	return response;
}

/**
 * JSON response carrying a `Set-Cookie` header.
 *
 * `Set-Cookie` cannot be set through the `ResponseInit.headers` object literal
 * without losing the cookie's own attribute separators, so it is appended to the
 * header list explicitly.
 */
export function jsonWithSetCookie<TBody>(
	body: TBody,
	setCookie: string,
	status = 200
): NextResponse {
	const response = NextResponse.json(body, { status });
	response.headers.append("Set-Cookie", setCookie);
	return response;
}
