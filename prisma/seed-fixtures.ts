/**
 * Fixture access shared by the seed scripts.
 *
 * `prisma/seed.ts` (the demo/reset fixture) and `prisma/seed-reference.ts` (the
 * production reference data) read the same JSON fixtures, and the demo fixture
 * also reads `generate_data.sql`. Resolving those paths lives here so both
 * scripts agree on where a fixture may be found.
 *
 * Two layouts have to work, because these scripts run in two shapes:
 *
 *   - under `tsx`, straight from the repository (`<root>/prisma/…`);
 *   - compiled by `npm run build:server`, from `<root>/dist/prisma/…`, which is
 *     what `npm run seed:prod` and `npm run seed:reference:prod` execute.
 *
 * The compiled layout is the awkward one: `tsc` emits JavaScript only and does
 * not copy the `.sql` and `.json` fixtures into `dist/`, while `__dirname` is
 * then `dist/prisma` rather than `prisma`. The search below therefore starts at
 * the working directory (the project root in every documented invocation) and
 * falls back to walking up to the source tree, so the compiled scripts work
 * without a build step that copies fixtures around.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";

/** A row of `prisma/seed_data/cities.json`. */
export interface SeedCity {
	city: string;
	country: string;
}

/** A row of `prisma/seed_data/airports.json`. */
export interface SeedAirport {
	id: string;
	code: string;
	name: string;
	city: string;
	country: string;
}

/**
 * Every path a fixture may live at, most likely first.
 *
 * @param relativePath path relative to the repository's `prisma/` directory,
 *                     e.g. `generate_data.sql` or `seed_data/cities.json`.
 */
function fixtureCandidates(relativePath: string): string[] {
	return [
		// Run from the project root (the documented invocation): the source tree.
		path.join(process.cwd(), "prisma", relativePath),
		path.join(process.cwd(), relativePath),
		// Compiled: dist/prisma/../../prisma is the source tree again.
		path.join(__dirname, "..", "..", "prisma", relativePath),
		// Source: prisma/../prisma normalises back to prisma/.
		path.join(__dirname, "..", "prisma", relativePath),
		// A script invoked from a directory that holds its own fixtures.
		path.join(__dirname, relativePath),
	];
}

/**
 * Resolve a fixture file to an absolute path.
 *
 * @throws when nothing matches, naming every path that was tried: the usual
 *         cause is running the script from an unexpected directory, and the
 *         candidate list is what turns that into a fixable error.
 */
export function resolveSeedFixture(relativePath: string): string {
	const candidates = fixtureCandidates(relativePath);
	const found = candidates.find((candidate) => existsSync(candidate));
	if (found === undefined) {
		throw new Error(
			`Seed fixture "${relativePath}" was not found. Looked in:\n` +
				candidates.map((candidate) => `  - ${candidate}`).join("\n") +
				`\nRun the seed from the project root.`
		);
	}
	return found;
}

/** Parse a JSON fixture, e.g. `seed_data/cities.json`. */
export function readSeedJson<T>(relativePath: string): T {
	return JSON.parse(readFileSync(resolveSeedFixture(relativePath), "utf-8")) as T;
}

/** Read a SQL fixture as text, e.g. `generate_data.sql`. */
export function readSeedSql(relativePath: string): string {
	return readFileSync(resolveSeedFixture(relativePath), "utf-8");
}
