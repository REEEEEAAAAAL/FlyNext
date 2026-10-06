/**
 * `POST /api/auth/register`
 *
 * Response contract, relied on by `app/auth/register/page.tsx`:
 * - `400 { error: string }`
 * - `409 { error: "Email already in use" }`
 * - `429 { error: string }` — account creation is the most tightly budgeted
 *   route on the API, to keep bulk signup from being free
 * - `201 { message: "Registered successfully" }`
 *
 * The address is normalised to lower case before it is stored and the duplicate
 * check is case-insensitive, so `User@example.com` cannot become a second account
 * beside `user@example.com`. Password length is enforced, and every failure is
 * rendered by the shared error boundary rather than echoing driver internals.
 */

import { badRequest, conflict } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonMessage } from "@/lib/api/response";
import { parseJsonBody, readString, requireEmail } from "@/lib/api/validation";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Minimum accepted password length. */
const MIN_PASSWORD_LENGTH = 6;

export const POST = withRoute(async (request) => {
	enforceRateLimit(request, "register");

	const body = await parseJsonBody(request);

	const email = requireEmail(body);
	const password = readString(body, "password", { maxLength: 200 });
	const firstName = readString(body, "firstName", { maxLength: 100 });
	const lastName = readString(body, "lastName", { maxLength: 100 });

	if (password === undefined || firstName === undefined || lastName === undefined) {
		throw badRequest("Missing required fields");
	}
	if (password.length < MIN_PASSWORD_LENGTH) {
		throw badRequest(
			`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
		);
	}

	// `profilePic` and `phone` are optional profile extras.
	const profilePic = readString(body, "profilePic", { maxLength: 2048 });
	const phone = readString(body, "phone", { maxLength: 40 });

	/*
	 * The duplicate check is case-insensitive rather than an exact match on the
	 * normalised address, so an account that already exists under a mixed-case
	 * spelling cannot be shadowed by a second registration.
	 */
	const existing = await prisma.user.findFirst({
		where: { email: { equals: email, mode: "insensitive" } },
		select: { id: true },
	});
	if (existing !== null) {
		throw conflict("Email already in use");
	}

	const hashedPassword = await hashPassword(password);

	await prisma.user.create({
		data: {
			email,
			password: hashedPassword,
			firstName,
			lastName,
			profilePic: profilePic ?? null,
			phone: phone ?? null,
		},
	});

	return jsonMessage("Registered successfully", 201);
});
