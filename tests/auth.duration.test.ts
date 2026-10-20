import { afterEach, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { generateAccessToken, getRefreshTokenMaxAgeSeconds, parseDurationToSeconds } from "@/lib/auth";
afterEach(() => vi.unstubAllEnvs());
it.each(["3600", "1h", "60m"])("B06 signs %s as exactly 3600 seconds", value => {
	vi.stubEnv("JWT_ACCESS_SECRET", "synthetic-only-secret");
	vi.stubEnv("JWT_ACCESS_TOKEN_EXPIRY_TIME", value);
	vi.stubEnv("JWT_REFRESH_TOKEN_EXPIRY_TIME", value);
	const token = jwt.decode(generateAccessToken({ userId: 1 })) as jwt.JwtPayload;
	expect(token.exp! - token.iat!).toBe(3600);
	expect(getRefreshTokenMaxAgeSeconds()).toBe(3600);
});
it.each(["0", "0s", "-1", "1.5h", "999999999999999999d", "junk"])("rejects invalid duration %s", value => {
	expect(() => parseDurationToSeconds(value, "test")).toThrow();
});
