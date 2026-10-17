import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), destroy: vi.fn() }));
vi.mock("cloudinary", () => ({ v2: { api: { config: vi.fn(async () => ({ settings: { folder_mode: "fixed" } })) }, uploader: {
	upload_stream: mocks.upload, destroy: mocks.destroy,
} } }));
import { MAX_TOTAL_IMAGE_BYTES, resolveImageEntries, saveImageUploads, validateImageSource, withUploadCleanup } from "@/lib/api/upload";
const file = () => new File(["synthetic image"], "image.jpg", { type: "image/jpeg" });
beforeEach(() => {
	vi.stubEnv("CLOUDINARY_URL", "");
	vi.stubEnv("CLOUDINARY_CLOUD_NAME", "synthetic-cloud");
	vi.stubEnv("CLOUDINARY_API_KEY", "synthetic-key");
	vi.stubEnv("CLOUDINARY_API_SECRET", "synthetic-secret");
	mocks.destroy.mockReset().mockResolvedValue({ result: "ok" });
	let id = 0;
	mocks.upload.mockReset().mockImplementation((_options, done) => {
		const publicId = `new/${++id}`;
		return { on() {}, end() { done(null, { public_id: publicId, url: "", secure_url: `https://res.cloudinary.com/synthetic-cloud/image/upload/${publicId}.jpg` }); } };
	});
});
afterEach(() => vi.unstubAllEnvs());
it.each(["https://evil.invalid/tracker.jpg", "javascript:alert(1)", "//evil.invalid/x", "https://res.cloudinary.com/other/image/upload/x.jpg", "https://res.cloudinary.com/synthetic-cloud/image/fetch/x", "https://res.cloudinary.com/synthetic-cloud/image/upload/x.jpg?x=1"])("rejects unsupported image source %s", value => {
	expect(() => validateImageSource(value)).toThrow("Unsupported image source");
});
it("allows bundled defaults and the configured Cloudinary image origin", () => {
	expect(validateImageSource("/hotel-logo-default.svg")).toBe("/hotel-logo-default.svg");
	expect(validateImageSource("https://res.cloudinary.com/synthetic-cloud/image/upload/v1/x.jpg")).toContain("/v1/x.jpg");
});
it("compensates only new assets after a database write failure", async () => {
	const form = new FormData();
	form.append("images", "https://res.cloudinary.com/synthetic-cloud/image/upload/retained.jpg");
	form.append("images", file());
	await expect(withUploadCleanup(async () => {
		await resolveImageEntries(form, "images", "hotels");
		throw new Error("database write failed");
	})).rejects.toThrow("database write failed");
	expect(mocks.destroy).toHaveBeenCalledTimes(1);
	expect(mocks.destroy.mock.calls[0][0]).toBe("new/1");
});
it("cleans up a partial multi-upload and withholds provider diagnostics", async () => {
	mocks.upload.mockImplementationOnce((_options, done) => ({ on() {}, end() { done(null, { public_id: "new/1", secure_url: "https://res.cloudinary.com/synthetic-cloud/image/upload/new/1.jpg" }); } }))
		.mockImplementationOnce((_options, done) => ({ on() {}, end() { done(new Error("sensitive provider diagnostic")); } }));
	await expect(withUploadCleanup(() => saveImageUploads([file(), file()], "hotels"))).rejects.toMatchObject({ message: "Image upload failed.", details: undefined });
	expect(mocks.destroy.mock.calls.map(row => row[0])).toEqual(["new/1"]);
});
it("bounds count and total size before uploading", async () => {
	await expect(saveImageUploads(Array.from({ length: 13 }, file), "hotels")).rejects.toThrow();
	const oversized = { size: MAX_TOTAL_IMAGE_BYTES + 1 } as File;
	await expect(saveImageUploads([oversized], "hotels")).rejects.toThrow();
	expect(mocks.upload).not.toHaveBeenCalled();
});
