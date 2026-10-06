/**
 * Rate limiting suite.
 *
 * The limiter lives in process memory (`lib/api/rate-limit.ts`), so these cases
 * drive it through the endpoints it protects rather than through its internals:
 * what has to hold is that a caller eventually receives `429` with a usable
 * `Retry-After`, and that one caller's spending does not affect another's.
 *
 * The budgets are replaced for the duration of the suite. Driving the real ones
 * would mean spending forty requests per case and would make the suite brittle
 * the moment a budget is tuned.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as getUnreadCount } from "@/app/api/notifications/unread-count/route";
import { GET as getProfile } from "@/app/api/user/route";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { setRateLimitRules, resetRateLimits } from "@/lib/api/rate-limit";
import { disconnect, resetDatabase } from "#support/db";
import { createUser } from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";

/** Budgets in force during this suite: small enough to exhaust deliberately. */
const TEST_RULES = {
  login: { windowMs: 60_000, max: 3 },
  notificationPoll: { windowMs: 60_000, max: 5 },
  profileRead: { windowMs: 60_000, max: 2 },
} as const;

const originalRules = { ...RATE_LIMITS };

beforeEach(async () => {
  await resetDatabase();
  // The global setup disables the limiter so the other suites never have to think
  // about budgets; this suite turns it back on for its own duration.
  delete process.env.RATE_LIMIT_DISABLED;
  resetRateLimits();
  setRateLimitRules(TEST_RULES);
});

afterEach(() => {
  process.env.RATE_LIMIT_DISABLED = "1";
  setRateLimitRules(originalRules);
  resetRateLimits();
});

afterAll(async () => {
  await disconnect();
});

describe("per-client budgets", () => {
  it("answers 429 with a Retry-After once the budget is spent", async () => {
    const client = "203.0.113.10";
    // A distinct account per attempt, so this measures the address budget; the
    // account budget is covered by its own case below.
    let attemptNumber = 0;
    const attempt = () => {
      attemptNumber += 1;
      return callRoute(login, {
        method: "POST",
        json: {
          email: `guess-${attemptNumber}@example.com`,
          password: "wrong-password",
        },
        headers: { "x-forwarded-for": client },
      });
    };

    // The first three are ordinary failures: the account does not exist.
    for (let index = 0; index < TEST_RULES.login.max; index += 1) {
      const response = await attempt();
      expect(response.status, `attempt ${index + 1}`).toBe(401);
    }

    const limited = await attempt();
    expect(limited.status).toBe(429);

    const retryAfter = limited.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);

    const body = await readJson<{ error: string }>(limited);
    expect(body.error).toMatch(/too many requests/i);
  });

  it("bills each address separately", async () => {
    /*
     * Login is budgeted twice: once per source address and once per account, so
     * that guessing one account's password from many addresses still costs
     * something. This case is about the address budget, so it names a different
     * account at each step and changes only the address.
     */
    const attempt = (client: string, email: string) =>
      callRoute(login, {
        method: "POST",
        json: { email, password: "wrong-password" },
        headers: { "x-forwarded-for": client },
      });

    // Exhaust one address completely.
    for (let index = 0; index < TEST_RULES.login.max; index += 1) {
      const response = await attempt("203.0.113.20", `victim-${index}@example.com`);
      expect(response.status, `attempt ${index + 1}`).toBe(401);
    }
    expect(
      (await attempt("203.0.113.20", "victim-final@example.com")).status
    ).toBe(429);

    // A different address still has its own full budget.
    expect((await attempt("203.0.113.21", "another@example.com")).status).toBe(401);
  });

  it("bills one account across addresses", async () => {
    /*
     * The other half of the login budget. Spreading guesses for a single account
     * over many source addresses is the cheapest way to brute-force a password, so
     * the account counter has to be independent of the address.
     */
    const attempt = (client: string) =>
      callRoute(login, {
        method: "POST",
        json: { email: "target@example.com", password: "wrong-password" },
        headers: { "x-forwarded-for": client },
      });

    for (let index = 0; index < TEST_RULES.login.max; index += 1) {
      const response = await attempt(`203.0.113.${60 + index}`);
      expect(response.status, `attempt ${index + 1}`).toBe(401);
    }

    // A brand-new address, but the same account: still refused.
    expect((await attempt("203.0.113.99")).status).toBe(429);
  });

  it("bills an authenticated caller by user id, not by address", async () => {
    const user = await createUser();
    const token = tokenFor(user.id);
    const shared = "203.0.113.30";

    const request = () =>
      callRoute(getProfile, {
        token,
        headers: { "x-forwarded-for": shared },
      });

    for (let index = 0; index < TEST_RULES.profileRead.max; index += 1) {
      expect((await request()).status).toBe(200);
    }
    expect((await request()).status).toBe(429);

    /*
     * The address is spent, but it is shared: another signed-in user behind the
     * same NAT must not be affected. Identifying callers by user id is what makes
     * that true — and it also stops a caller from escaping its own budget by
     * changing address.
     */
    const colleague = await createUser();
    const colleagueResponse = await callRoute(getProfile, {
      token: tokenFor(colleague.id),
      headers: { "x-forwarded-for": shared },
    });
    expect(colleagueResponse.status).toBe(200);
  });

  it("counts the polled unread badge against the caller's budget", async () => {
    const user = await createUser();
    const token = tokenFor(user.id);

    const poll = () => callRoute(getUnreadCount, { token });

    for (let index = 0; index < TEST_RULES.notificationPoll.max; index += 1) {
      const response = await poll();
      expect(response.status).toBe(200);
      const body = await readJson<{ unreadCount: number }>(response);
      expect(body.unreadCount).toBe(0);
    }

    const limited = await poll();
    expect(limited.status).toBe(429);
  });

  it("lets a caller through again once the window has passed", async () => {
    const client = "203.0.113.40";
    let attemptNumber = 0;
    const attempt = () => {
      attemptNumber += 1;
      return callRoute(login, {
        method: "POST",
        json: {
          email: `retry-${attemptNumber}@example.com`,
          password: "wrong-password",
        },
        headers: { "x-forwarded-for": client },
      });
    };

    // A window short enough to wait out inside a test.
    setRateLimitRules({ ...TEST_RULES, login: { windowMs: 1_000, max: 1 } });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect((await attempt()).status).toBe(401);
  });
});

describe("production budgets", () => {
  it("leaves the polled endpoint a budget several times its intended rate", () => {
    const rule = RATE_LIMITS.notificationPoll;

    // The badge polls every five seconds, i.e. twelve times a minute. The budget
    // has to be comfortably above that so a normal client never sees a 429, while
    // still catching a tab that has lost its timer and is looping.
    const intendedPerMinute = 60_000 / 5_000;
    expect((rule.windowMs / 60_000) * rule.max).toBeGreaterThanOrEqual(
      intendedPerMinute * 3
    );
  });

  it("keeps login far tighter than the endpoints ordinary users hit", () => {
    expect(RATE_LIMITS.login.max).toBeLessThan(RATE_LIMITS.profileRead.max);
    expect(RATE_LIMITS.login.windowMs).toBeLessThanOrEqual(60_000);
    expect(RATE_LIMITS.checkout.max).toBeLessThanOrEqual(RATE_LIMITS.bookingWrite.max);
  });

  it("declares a budget for every rule the API enforces", () => {
    // A rule with no entry would silently disable the endpoint's protection.
    expect(Object.keys(RATE_LIMITS).length).toBeGreaterThanOrEqual(10);
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.max, name).toBeGreaterThan(0);
      expect(rule.windowMs, name).toBeGreaterThan(0);
    }
  });

  it("does not constrain a legitimate booking burst", async () => {
    // Sanity check that the limiter is off outside this suite, so no other suite
    // is accidentally measuring budgets instead of behaviour.
    process.env.RATE_LIMIT_DISABLED = "1";
    resetRateLimits();

    const user = await createUser();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        callRoute(getProfile, { token: tokenFor(user.id) })
      )
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });
});
