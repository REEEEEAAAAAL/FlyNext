import type { OperationEnvironment } from "./database-safety";

const neonHost = /^ep-[a-z0-9-]+\.(?:c-\d+\.)?[a-z0-9-]+\.(?:aws|azure)\.neon\.tech$/;
const directHost = (host: string) => host.replace("-pooler.", ".");

export function assertCiDatabaseTarget(databaseUrl: string, env: OperationEnvironment): void {
  const expected = env.CI_TEST_DATABASE_HOST ?? "";
  const url = new URL(databaseUrl);
  if (!neonHost.test(expected) || expected !== directHost(expected) ||
      directHost(url.hostname) !== expected || decodeURIComponent(url.username) !== "flynext_ci_runner") {
    throw new Error("CI requires the allowlisted Neon endpoint and dedicated flynext_ci_runner role.");
  }
}

export function ciBusinessDatabaseUrls(value: string | undefined): string[] {
  const invalid = () => new Error("CI requires a nonempty credential-free business database exclusion list.");
  let entries: unknown;
  try { entries = JSON.parse(value ?? ""); } catch { throw invalid(); }
  if (!Array.isArray(entries) || entries.length === 0) throw invalid();
  return entries.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("host" in entry) || !("database" in entry) ||
        typeof entry.host !== "string" || !neonHost.test(entry.host) ||
        typeof entry.database !== "string" || !/^[A-Za-z0-9_-]+$/.test(entry.database) ||
        Object.keys(entry).some(key => key !== "host" && key !== "database")) throw invalid();
    return `postgresql://${directHost(entry.host)}:5432/${entry.database}`;
  });
}
