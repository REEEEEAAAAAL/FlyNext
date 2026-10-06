/**
 * Minimal `.env` reader for the test setup.
 *
 * `dotenv` is not a dependency of this project and the suites need one file read
 * once, so the parsing lives here rather than adding a package for it. The format
 * supported is the one the repository's own `.env` files use: `KEY=value`, one per
 * line, optional surrounding quotes, and `#` comments.
 *
 * `process.env` is deliberately overwritten rather than only filled in when
 * absent. `next dev` and the Prisma CLI both load `.env` automatically, so a value
 * left over from the shell must not win over the one in `.env.test` — silently
 * using the development database is the failure this whole module exists to
 * prevent.
 */

import { readFileSync } from "node:fs";

/** Read and apply a `.env`-format file. */
export function loadEnvFile(path: string): Record<string, string> {
  const contents = readFileSync(path, "utf8");
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    // Strip one layer of matching quotes; the quotes are syntax, not content.
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
    process.env[key] = value;
  }

  return parsed;
}
