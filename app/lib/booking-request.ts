import { sessionFetch } from "./session";

const memory = new Map<string, string>();
async function intentSlot(url: string, body: RequestInit["body"]): Promise<string> {
	const signature = `${url}:${typeof body === "string" ? body : ""}`;
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
	return `flynext.booking.${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

// An unacknowledged intent survives reloads and lost responses.
export async function bookingRequest(url: string, init: RequestInit): Promise<Response> {
	const slot = await intentSlot(url, init.body);
	let key = memory.get(slot);
	try { key = sessionStorage.getItem(slot) ?? key; } catch { /* Use the current tab's memory when storage is disabled. */ }
	if (!key) key = crypto.randomUUID();
	memory.set(slot, key);
	try { sessionStorage.setItem(slot, key); } catch { /* The in-memory key still protects retries in this tab. */ }
	const headers = new Headers(init.headers);
	headers.set("Idempotency-Key", key);
	return sessionFetch(url, { ...init, headers });
}

// Acknowledgement allows a later deliberate booking with the same inputs.
export async function acknowledgeBooking(url: string, body: unknown): Promise<void> {
	const slot = await intentSlot(url, JSON.stringify(body));
	memory.delete(slot);
	try { sessionStorage.removeItem(slot); } catch { /* Storage can be disabled. */ }
}
