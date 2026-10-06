/**
 * Folder placement for uploaded images.
 *
 * The suite runs with the Cloudinary credentials blank, so `saveImageUpload`
 * returns a mock URL and never reaches the network. That makes the decision
 * about where an asset would go the part worth pinning down, and it is pure:
 * {@link planUpload} and {@link normaliseFolder} are exercised directly, plus
 * {@link readCloudinaryConfig} for the value it actually reads from the
 * environment.
 *
 * The rule these cases protect is the one an operator notices only when it is
 * broken: an upload from this project always lands under
 * `<CLOUDINARY_FOLDER>/<bucket>/`, never at the account root, and never with a
 * malformed public ID — however odd the configured folder happens to be.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	normaliseFolder,
	planUpload,
	readCloudinaryConfig,
} from "@/lib/api/upload";

/** Every variable placement reads, so a developer's shell cannot leak in. */
const CLOUDINARY_KEYS = [
	"CLOUDINARY_URL",
	"CLOUDINARY_CLOUD_NAME",
	"CLOUDINARY_API_KEY",
	"CLOUDINARY_API_SECRET",
	"CLOUDINARY_FOLDER",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = {};
	for (const key of CLOUDINARY_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of CLOUDINARY_KEYS) {
		const value = saved[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("normaliseFolder", () => {
	it("falls back to flynext when nothing usable is left", () => {
		for (const raw of [
			undefined,
			"",
			"   ",
			"/",
			"//",
			".",
			"..",
			"./",
			"../",
			"/./",
			" / ",
		]) {
			expect(normaliseFolder(raw), JSON.stringify(raw)).toBe("flynext");
		}
	});

	it("keeps a real path while dropping empty and relative segments", () => {
		expect(normaliseFolder("flynext")).toBe("flynext");
		expect(normaliseFolder("  flynext  ")).toBe("flynext");
		expect(normaliseFolder("/flynext/")).toBe("flynext");
		expect(normaliseFolder("a//b/")).toBe("a/b");
		expect(normaliseFolder("./a/../b")).toBe("a/b");
		expect(normaliseFolder("team/flynext")).toBe("team/flynext");
	});
});

describe("planUpload", () => {
	const uuid = "123e4567-e89b-42d3-a456-426614174000";

	it("prefixes the public id with the root and the bucket", () => {
		for (const mode of ["fixed", "unknown"] as const) {
			const placement = planUpload("flynext", "hotels", mode, uuid);

			expect(placement.publicId).toBe(`flynext/hotels/${uuid}`);
			expect(placement.publicId.startsWith("flynext/hotels/")).toBe(true);
			// The `folder` parameter is not honoured outside dynamic folders, so it
			// must not be relied on in this branch.
			expect("folder" in placement).toBe(false);
		}
	});

	it("honours a custom root and every bucket", () => {
		expect(planUpload("my-root", "roomTypes", "fixed", uuid).publicId).toBe(
			`my-root/roomTypes/${uuid}`
		);
		expect(planUpload("my-root", "userProfiles", "fixed", uuid).publicId).toBe(
			`my-root/userProfiles/${uuid}`
		);
	});

	it("never places an asset at the account root", () => {
		for (const raw of ["", "/", "..", "  ", "///"]) {
			expect(planUpload(raw, "hotels", "fixed", uuid).publicId).toBe(
				`flynext/hotels/${uuid}`
			);
		}
	});

	it("declares the folder on dynamic-folder accounts without nesting twice", () => {
		const placement = planUpload("flynext", "hotels", "dynamic", uuid);

		expect(placement).toEqual({
			publicId: uuid,
			folder: "flynext/hotels",
			useAssetFolderAsPublicIdPrefix: true,
		});
		// The path appears once, in `folder` — not twice.
		expect(placement.publicId.includes("flynext")).toBe(false);
	});
});

describe("readCloudinaryConfig", () => {
	it("defaults an unusable folder instead of leaving it empty", () => {
		process.env.CLOUDINARY_CLOUD_NAME = "demo";
		process.env.CLOUDINARY_API_KEY = "key";
		process.env.CLOUDINARY_API_SECRET = "secret";

		expect(readCloudinaryConfig()?.folder).toBe("flynext");

		for (const raw of ["", "   ", "/", ".."]) {
			process.env.CLOUDINARY_FOLDER = raw;
			expect(readCloudinaryConfig()?.folder, JSON.stringify(raw)).toBe(
				"flynext"
			);
		}

		process.env.CLOUDINARY_FOLDER = "my-root/";
		expect(readCloudinaryConfig()?.folder).toBe("my-root");
	});

	it("reads the folder from a CLOUDINARY_URL deployment too", () => {
		process.env.CLOUDINARY_URL = "cloudinary://key:secret@demo";

		expect(readCloudinaryConfig()?.folder).toBe("flynext");

		process.env.CLOUDINARY_FOLDER = "/team/";
		expect(readCloudinaryConfig()?.folder).toBe("team");
	});
});
