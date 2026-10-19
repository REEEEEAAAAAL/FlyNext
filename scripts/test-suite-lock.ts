import { mkdirSync, openSync, writeFileSync, closeSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

export function acquireTestSuiteLock(): () => void {
  mkdirSync(resolve(".database-maintenance"), { recursive: true });
  const path = resolve(".database-maintenance/test-suite.lock");
  let descriptor: number;
  try { descriptor = openSync(path, "wx"); }
  catch { throw new Error("Another database suite holds the lock. Verify its process has stopped before removing the stale lock."); }
  writeFileSync(descriptor, String(process.pid));
  return () => { closeSync(descriptor); unlinkSync(path); };
}

export function withTestSuiteLock<T>(run: () => T): T {
  const release = acquireTestSuiteLock();
  try { return run(); }
  finally { release(); }
}
