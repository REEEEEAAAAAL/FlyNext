/**
 * Transport-level types shared by every HTTP handler under `app/api`.
 *
 * These shapes are part of the public contract with the Next.js client, so they
 * are intentionally narrow:
 *
 * - failures are always `{ error: string }`, optionally with `details`
 * - action-only successes are `{ message: string }`
 * - numeric payload fields must serialise as JSON numbers, never strings, because
 *   the client calls `Number.prototype.toFixed` on several of them.
 */

import type { Prisma } from "@prisma/client";

/** Body of every non-2xx JSON response. */
export interface ApiErrorBody {
	/** Human readable, safe to display. Never contains a stack trace. */
	error: string;
	/** Optional extra context. Must not leak internal implementation details. */
	details?: string;
}

/** Body of an acknowledgement-only success response. */
export interface ApiMessageBody {
	message: string;
}

/** Alias kept for readability at call sites. */
export type ErrorResponse = ApiErrorBody;

/** Alias kept for readability at call sites. */
export type MessageResponse = ApiMessageBody;

/** A raw query-string value as produced by `URLSearchParams#get`. */
export type QueryValue = string | null;

/** HTTP verbs used by this API. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * JSON-safe value.
 *
 * This is Prisma's `JsonValue` rather than a hand-written recursive union: the
 * value comes from a `Json` column, and a structurally similar local alias is not
 * interchangeable with it (`JsonObject` has an index signature, which cannot be
 * proven assignable to a closed union). Aliasing keeps the two worlds identical
 * instead of forcing casts at every boundary.
 */
export type JsonValue = Prisma.JsonValue;

/** JSON object member of {@link JsonValue}. */
export type JsonObject = Prisma.JsonObject;

/** Scalar member of {@link JsonValue}. */
export type JsonPrimitive = string | number | boolean | null;
