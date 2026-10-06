/**
 * `GET    /api/hotels/[hotelId]` — public hotel detail (with room types).
 * `PUT    /api/hotels/[hotelId]` — update a hotel (owner only, multipart).
 * `DELETE /api/hotels/[hotelId]` — delete a hotel (owner only).
 *
 * Response contract, relied on by `app/hotels/[hotelId]/page.tsx` (public, sends
 * no headers at all) and `app/hotels/[hotelId]/edit/page.tsx`:
 * - `200 { hotel: HotelWithRoomTypes }`
 * - `200 { message: "Hotel updated", hotel: { … } }` — the edit page reads
 *   `resData.hotel.images` to refresh its gallery
 * - `200 { message: "Hotel deleted" }`
 * - `400`, `401`, `403`, `404 { error: string }`
 *
 * Every handler is a `withRoute` body, so a failure — including a rejected
 * database call during authentication — is rendered as the JSON envelope the
 * client expects rather than as an HTML error page. `hotelId` is validated as a
 * positive integer (`400`, not `500`, for a non-numeric segment) and `starRating`
 * as an integer in 1–5, which is what the `Int` column accepts.
 */

import { requireAuth } from "@/lib/api/auth";
import { forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { jsonMessage, jsonOk } from "@/lib/api/response";
import { resolveImageEntries, saveImageUploads } from "@/lib/api/upload";
import {
	parseRouteId,
	readFormFiles,
	readFormString,
	requireFormInt,
} from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import type { HotelWithRoomTypes } from "@/types";

/** Star ratings are constrained to the 1–5 scale the UI renders as ★/☆. */
const MIN_STARS = 1;
const MAX_STARS = 5;

/**
 * Load a hotel and assert the caller owns it.
 *
 * @throws ApiError `404` when the hotel does not exist, `403` when it belongs to
 *   somebody else — the two statuses the edit page expects.
 */
async function requireOwnedHotel(hotelId: number, userId: number) {
	const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
	if (hotel === null) {
		throw notFound("Hotel not found");
	}
	if (hotel.ownerId !== userId) {
		throw forbidden("Operation is forbidden");
	}
	return hotel;
}

export const GET = withRoute<{ hotelId: string }>(async (_request, context) => {
	const { hotelId: rawHotelId } = await context.params;
	const hotelId = parseRouteId(rawHotelId, "hotelId");

	const hotel = await prisma.hotel.findUnique({
		where: { id: hotelId },
		include: { roomTypes: true },
	});
	if (hotel === null) {
		throw notFound("Hotel not found");
	}

	const payload: { hotel: HotelWithRoomTypes } = { hotel };
	return jsonOk(payload);
});

export const PUT = withRoute<{ hotelId: string }>(async (request, context) => {
	const { hotelId: rawHotelId } = await context.params;
	const hotelId = parseRouteId(rawHotelId, "hotelId");
	const { userId } = requireAuth(request);

	await requireOwnedHotel(hotelId, userId);

	const formData = await request.formData();

	// Only the whitelisted columns can be written; anything else in the form is
	// ignored rather than reaching Prisma.
	const updates: {
		name?: string;
		address?: string;
		location?: string;
		starRating?: number;
		logo?: string;
		images?: string[];
	} = {};

	const name = readFormString(formData, "name", { maxLength: 200 });
	if (name !== undefined) {
		updates.name = name;
	}
	const address = readFormString(formData, "address", { maxLength: 300 });
	if (address !== undefined) {
		updates.address = address;
	}
	const location = readFormString(formData, "location", { maxLength: 200 });
	if (location !== undefined) {
		updates.location = location;
	}
	if (formData.get("starRating") !== null) {
		updates.starRating = requireFormInt(formData, "starRating", {
			min: MIN_STARS,
			max: MAX_STARS,
		});
	}

	// A single new logo replaces the current one; the form sends either a File or
	// the existing URL.
	const logoFiles = readFormFiles(formData, "logo");
	if (logoFiles.length > 0) {
		const urls = await saveImageUploads(logoFiles, "hotels");
		updates.logo = urls[0];
	}

	// The gallery is replaced wholesale by whatever the form submitted, which is
	// the documented behaviour of the edit page.
	updates.images = await resolveImageEntries(formData, "images", "hotels");

	const updatedHotel = await prisma.hotel.update({
		where: { id: hotelId },
		data: updates,
	});

	return jsonOk({ message: "Hotel updated", hotel: updatedHotel });
});

export const DELETE = withRoute<{ hotelId: string }>(async (request, context) => {
	const { hotelId: rawHotelId } = await context.params;
	const hotelId = parseRouteId(rawHotelId, "hotelId");
	const { userId } = requireAuth(request);

	await requireOwnedHotel(hotelId, userId);

	// Room types cascade; linked reservations have their `hotelId` set to null.
	await prisma.hotel.delete({ where: { id: hotelId } });

	return jsonMessage("Hotel deleted", 200);
});
