/**
 * `GET /api/user` — the signed-in user's profile.
 * `PUT /api/user` — update the profile (multipart/form-data, optional avatar).
 *
 * Response contract, relied on by 22 call sites across the client:
 * - `401 { error: "Unauthorized" }`
 * - `404 { error: string }` when the row is gone
 * - `200 { user: { id, email, firstName, lastName, profilePic, phone, IsHotelOwner } }`
 * - `200 { message: "Profile updated successfully.", user: { … } }`
 *
 * `profilePic` on `GET` falls back to `"/user-profile-default.svg"`, and the
 * capital `I` in `IsHotelOwner` is load-bearing: three pages gate owner-only UI
 * on `data.user.IsHotelOwner === false`.
 *
 * `PUT` reads every optional field through the validation helpers, so a `File`
 * submitted where a scalar is expected is ignored rather than reaching Prisma, and
 * the stored avatar extension is derived from the validated MIME type rather than
 * from the uploaded file's own name (see `lib/api/upload.ts`).
 */

import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/api/auth";
import { badRequest, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import { saveImageUpload } from "@/lib/api/upload";
import { prisma } from "@/lib/prisma";
import type { UserProfile } from "@/types";

/** Columns exposed by the `GET` response. */
const PROFILE_SELECT = {
	id: true,
	email: true,
	firstName: true,
	lastName: true,
	profilePic: true,
	phone: true,
	IsHotelOwner: true,
} as const satisfies Prisma.UserSelect;

/** Default avatar used when the user has never uploaded one. */
const DEFAULT_AVATAR = "/user-profile-default.svg";

/** Longest accepted value for the free-text profile fields. */
const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 40;

/**
 * Read an optional form field, distinguishing "absent" from "cleared".
 *
 * @returns `undefined` when the field was not submitted (leave unchanged),
 *   `null` when it was submitted empty (clear it), otherwise the trimmed value.
 * @throws ApiError `400` when the value exceeds `maxLength`.
 */
function readClearableFormText(
	formData: FormData,
	field: string,
	maxLength: number
): string | null | undefined {
	const value = formData.get(field);
	if (value === null || typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	if (trimmed.length > maxLength) {
		throw badRequest(`Field "${field}" must be at most ${maxLength} characters`);
	}
	return trimmed;
}

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "profileRead");

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: PROFILE_SELECT,
	});
	if (user === null) {
		throw notFound("User not found");
	}

	const profile: UserProfile = {
		...user,
		profilePic: user.profilePic ?? DEFAULT_AVATAR,
	};
	return jsonOk({ user: profile });
});

export const PUT = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "profileWrite");
	const formData = await request.formData();

	const data: Prisma.UserUpdateInput = {};

	// Names must stay non-empty: an empty submission is a client error rather
	// than a silent blanking of a NOT NULL column.
	const firstName = readClearableFormText(formData, "firstName", MAX_NAME_LENGTH);
	if (firstName === null) {
		throw badRequest("First name cannot be empty");
	}
	if (firstName !== undefined) {
		data.firstName = firstName;
	}

	const lastName = readClearableFormText(formData, "lastName", MAX_NAME_LENGTH);
	if (lastName === null) {
		throw badRequest("Last name cannot be empty");
	}
	if (lastName !== undefined) {
		data.lastName = lastName;
	}

	// `phone` is nullable, so an empty submission clears it.
	const phone = readClearableFormText(formData, "phone", MAX_PHONE_LENGTH);
	if (phone !== undefined) {
		data.phone = phone;
	}

	const profilePic = formData.get("profilePic");
	if (profilePic !== null && typeof profilePic !== "string" && profilePic.size > 0) {
		data.profilePic = await saveImageUpload(profilePic, "userProfiles");
	}

	const updatedUser = await prisma.user.update({
		where: { id: userId },
		data,
		select: {
			id: true,
			email: true,
			firstName: true,
			lastName: true,
			profilePic: true,
			phone: true,
		},
	});

	return jsonOk({
		message: "Profile updated successfully.",
		user: updatedUser,
	});
});
