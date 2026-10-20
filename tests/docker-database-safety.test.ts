import { describe, expect, it, vi } from "vitest";
import { assertDockerDatabaseIdentity, assertDockerOperationMode } from "@/lib/docker-database-safety";
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";

vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "172.19.0.2", family: 4 }]) }));
const id = "a1111111-1111-4111-8111-111111111111";

describe("Docker database isolation", () => {
	it("keeps built-in reset available and refuses remote ticket orphaning before connection", () => {
		expect(() => assertDockerOperationMode({ AFS_MOCK: "true" }, "reset")).not.toThrow();
		for (const flag of [undefined, "", "false"]) {
			expect(() => assertDockerOperationMode({ AFS_MOCK: flag }, "reset")).toThrow("remote tickets must be reconciled");
		}
		expect(() => assertDockerOperationMode({ AFS_MOCK: "false" }, "start")).not.toThrow();
	});
	const env = {
		NODE_ENV: "development", COMPOSE_PROJECT_NAME: "flynext-local-aabbccddeeff",
		FLYNEXT_DOCKER_INSTANCE_ID: id, FLYNEXT_ALLOW_DATABASE_RESET: "1", FLYNEXT_DOCKER_ACTION: "reset",
		DATABASE_URL: "postgresql://flynext_docker:synthetic@postgres:5432/flynext_docker_demo?connection_limit=1&connect_timeout=5",
	};
	const identity = { name: "flynext_docker_demo", role: "flynext_docker", address: "172.19.0.2", port: 5432,
		id, system_id: "123456", actual_system_id: "123456", privileged: false };
	function setup() {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		const db = new PrismaClient();
		const query = vi.spyOn(db, "$queryRaw").mockResolvedValue([identity]);
		return { db, query };
	}
	it("requires the protected instance marker, physical cluster, server address and nonprivileged role", async () => {
		const { db, query } = setup();
		await expect(assertDockerDatabaseIdentity(db, env, true)).resolves.toBeUndefined();
		for (const patch of [{ id: "other" }, { actual_system_id: "other" }, { address: "203.0.113.1" },
			{ name: "other" }, { role: "other" }, { privileged: true }, { port: 5433 }]) {
			query.mockResolvedValue([{ ...identity, ...patch }]);
			await expect(assertDockerDatabaseIdentity(db, env, true)).rejects.toThrow("identity mismatch");
		}
	});
	it("rejects external routing, deployment environments and missing reset consent before connecting", async () => {
		const { db, query } = setup();
		for (const patch of [{ DATABASE_URL: env.DATABASE_URL.replace("@postgres:", "@external.invalid:") },
			{ DATABASE_URL: env.DATABASE_URL + "&host=external.invalid" }, { VERCEL: "1" }, { NODE_ENV: "production" },
			{ FLYNEXT_ALLOW_DATABASE_RESET: undefined }, { FLYNEXT_DOCKER_ACTION: undefined }, { COMPOSE_PROJECT_NAME: "flynext" }]) {
			await expect(assertDockerDatabaseIdentity(db, { ...env, ...patch }, true)).rejects.toThrow();
		}
		expect(query).not.toHaveBeenCalled();
		vi.mocked(fs.existsSync).mockReturnValue(false);
		await expect(assertDockerDatabaseIdentity(db, env, true)).rejects.toThrow("target refused");
	});
});
