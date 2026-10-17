import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
export const unitTestFiles = [
	"tests/booking-display.test.ts",
	"tests/upload.folder.test.ts",
	"tests/flights.directions.test.ts",
	"tests/database-safety.test.ts",
];
export const aliases = [
	{ find: /^@\//, replacement: `${root}/` },
	{ find: /^#support\//, replacement: `${root}/tests/support/` },
	{ find: /^#setup\//, replacement: `${root}/tests/setup/` },
];
