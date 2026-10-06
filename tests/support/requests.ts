/**
 * Helpers for calling App Router handlers from a test.
 *
 * A route module exports `GET`/`POST`/… functions with the signature
 * `(request: NextRequest, context: { params: Promise<TParams> }) => Promise<Response>`,
 * so a test invokes them directly with a real `NextRequest` and a params promise
 * — no HTTP server, no port, no mocking of the framework's request object. What
 * that skips is exactly the part with no behaviour of its own (routing and body
 * transport) and what it keeps is everything under test: authentication, the
 * error boundary, validation, Prisma and the transaction.
 */

import { NextRequest } from "next/server";
import { generateAccessToken } from "@/lib/auth";
import type { RouteContext, RouteParams } from "@/types";

/** A handler as a route module exports it. */
export type RouteHandler<TParams extends RouteParams = RouteParams> = (
  request: NextRequest,
  context: RouteContext<TParams>
) => Promise<Response>;

/** Options accepted by {@link callRoute}. */
export interface CallRouteOptions<TParams extends RouteParams> {
  /** HTTP method to present to the handler. Defaults to `"GET"`. */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Dynamic route segments, resolved by the handler's `await context.params`. */
  params?: TParams;
  /** `Authorization: Bearer …` value. Pass `null` for an anonymous request. */
  token?: string | null;
  /** JSON request body. Mutually exclusive with `formData`. */
  json?: unknown;
  /** `multipart/form-data` body. Mutually exclusive with `json`. */
  formData?: FormData;
  /** Extra request headers, e.g. a cookie or a forwarding address. */
  headers?: Record<string, string>;
  /** Raw query string, without the leading `?`. */
  query?: string;
  /** Overrides the base URL, for tests that assert on redirects. */
  url?: string;
}

/**
 * Build the request a handler will receive.
 *
 * `x-forwarded-for` is set to a per-call unique address unless the caller
 * supplies one, so that rate-limit tests can address separate clients and the
 * other suites never collide with each other's counters.
 */
export function buildRequest<TParams extends RouteParams>(
  options: CallRouteOptions<TParams>
): NextRequest {
  const method = options.method ?? "GET";
  const url = options.url ?? `http://localhost:3000/api/test`;
  const target =
    options.query === undefined || options.query.length === 0
      ? url
      : `${url}?${options.query}`;

  const headers = new Headers(options.headers ?? {});
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", uniqueClientAddress());
  }
  if (options.token !== undefined && options.token !== null) {
    headers.set("authorization", `Bearer ${options.token}`);
  } else if (options.token === undefined) {
    // `undefined` means "the caller did not care"; an explicit `null` means the
    // test wants to assert the anonymous path and sends nothing.
    headers.set("authorization", "");
  }

  // A narrowed shape rather than the global `RequestInit`: `NextRequest` declares
  // its own `RequestInit`, whose `signal` is not nullable.
  const init: {
    method: string;
    headers: Headers;
    body?: string | FormData;
  } = { method, headers };

  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(options.json);
  } else if (options.formData !== undefined) {
    // `FormData` sets its own multipart boundary; setting the header by hand
    // would omit it.
    init.body = options.formData;
  }

  return new NextRequest(target, init);
}

/** Invoke a handler the way the framework would. */
export async function callRoute<TParams extends RouteParams>(
  handler: RouteHandler<TParams>,
  options: CallRouteOptions<TParams> = {}
): Promise<Response> {
  const request = buildRequest(options);
  const context = {
    params: Promise.resolve(options.params ?? ({} as TParams)),
  } as RouteContext<TParams>;
  return handler(request, context);
}

/** Parse a JSON response body, failing the test on a non-JSON payload. */
export async function readJson<TBody = Record<string, unknown>>(
  response: Response
): Promise<TBody> {
  const text = await response.text();
  try {
    return JSON.parse(text) as TBody;
  } catch {
    throw new Error(
      `Expected a JSON body but received ${response.status} ` +
        `${response.headers.get("content-type") ?? "no content-type"}: ${text.slice(0, 300)}`
    );
  }
}

/** A signed access token for an existing user. */
export function tokenFor(userId: number): string {
  return generateAccessToken({ userId });
}

/**
 * A source address no other call in this process has used.
 *
 * Only the rate-limit suite depends on the distinction, but giving every call its
 * own address keeps budgets from leaking between tests that happen to run with
 * the limiter enabled.
 */
let addressCounter = 0;
function uniqueClientAddress(): string {
  addressCounter += 1;
  // 198.18.0.0/15 is reserved for benchmarking, so the addresses cannot collide
  // with anything a real client would present.
  return `198.18.${Math.floor(addressCounter / 250) % 250}.${(addressCounter % 250) + 1}`;
}

/** Reset the address sequence. Called from a suite that needs determinism. */
export function resetClientAddresses(): void {
  addressCounter = 0;
}
