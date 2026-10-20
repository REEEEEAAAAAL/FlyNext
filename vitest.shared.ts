import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
export const unitTestFiles = [
	"tests/hotel-inventory-horizon.test.ts",
    "tests/hotel-date-repair.test.ts",
    "tests/return-path.test.ts",
	"tests/booking-rules.test.ts",
	"tests/booking-display.test.ts",
	"tests/upload.folder.test.ts",
	"tests/flights.directions.test.ts",
	"tests/database-safety.test.ts",
	"tests/docker-database-safety.test.ts",
	"tests/auth.duration.test.ts",
	"tests/session.client.test.ts",
	"tests/upload.security.test.ts",
];
export const aliases = [
	{ find: /^@\//, replacement: `${root}/` },
	{ find: /^#support\//, replacement: `${root}/tests/support/` },
	{ find: /^#setup\//, replacement: `${root}/tests/setup/` },
];
