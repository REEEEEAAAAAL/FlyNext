import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

test("visitor entry points remain usable across viewport sizes and themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 720, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const dark of [false, true]) {
      await page.goto("/");
      await page.evaluate(value => document.documentElement.classList.toggle("dark", value), dark);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "Find a stay", exact:true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Explore flights" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const scan = await new AxeBuilder({page}).include("main").analyze();
      expect(scan.violations).toEqual([]);
    }
  }
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  expect(errors).toEqual([]);
});

for (const timezoneId of ["America/Toronto", "Asia/Shanghai", "Pacific/Honolulu"]) {
  test("hotel date inputs preserve UTC leap-day bounds in " + timezoneId, async ({ browser }) => {
    const context = await browser.newContext({timezoneId, viewport:{width:390,height:844}});
    const page = await context.newPage();
    try {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/hotels");
      await expect(page.getByRole("button", {name:"Search stays",exact:true})).toBeEnabled();
      await page.clock.install({time:new Date("2028-02-28T23:30:00Z")});
      const arrival = page.getByLabel("Check-in:", {exact:true});
      const departure = page.getByLabel("Check-out:", {exact:true});
      await arrival.fill("2028-02-28");
      await expect(arrival).toHaveAttribute("min", "2028-02-28");
      await expect(arrival).toHaveAttribute("max", "2028-04-28");
      await expect(departure).toHaveAttribute("max", "2028-04-29");
      await arrival.fill("2028-02-28");
      await expect(departure).toHaveAttribute("min", "2028-02-29");
      await departure.fill("2028-03-01");
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
}

test("hotel list restores its session and preserves search filters after booking", async ({page}) => {
  const fixture: unknown = JSON.parse(readFileSync("test-results/fixture.json","utf8"));
  if (!fixture || typeof fixture !== "object" || !("checkIn" in fixture) || typeof fixture.checkIn !== "string" || !("checkOut" in fixture) || typeof fixture.checkOut !== "string") throw new Error("Invalid test stay fixture");
  const email = "e2e-session-discovery@example.invalid";
  const password = "synthetic-e2e-session-password";
  expect((await page.request.post("/api/auth/register",{data:{email,password,firstName:"Synthetic",lastName:"Session"}})).status()).toBe(201);
  const login = await page.request.post("/api/auth/login",{data:{email,password}});
  expect(login.status()).toBe(200);
  const identity: unknown = await login.json();
  if (!identity || typeof identity !== "object" || !("accessToken" in identity) || typeof identity.accessToken !== "string") throw new Error("Missing test access token");
  const accessToken: string = identity.accessToken;
  let reservationId: number | undefined;
  let release = () => {};
  let arrived = () => {};
  const gate = new Promise<void>(resolve => {release = resolve;});
  const refreshing = new Promise<void>(resolve => {arrived = resolve;});
  await page.route("**/api/auth/refresh",async route => {arrived();await gate;await route.continue();});
  try {
    await page.goto("/hotels?" + new URLSearchParams({city:"Toronto",checkIn:fixture.checkIn,checkOut:fixture.checkOut}));
    await refreshing;
    await expect(page.getByRole("button",{name:"Search stays",exact:true})).toBeEnabled();
    await page.getByText("Refine your stay",{exact:true}).press("Enter");
    await expect(page.getByLabel("Maximum nightly rate (USD)",{exact:true})).toBeVisible();
    await page.getByLabel("Maximum nightly rate (USD)",{exact:true}).fill("100");
    const filtered = page.waitForResponse(value => new URL(value.url()).pathname === "/api/hotels" && new URL(value.url()).searchParams.get("priceMax") === "100");
    await page.getByRole("button",{name:"Search stays",exact:true}).click();
    expect((await filtered).status()).toBe(200);
    const refreshed = page.waitForResponse(value => new URL(value.url()).pathname === "/api/hotels" && new URL(value.url()).searchParams.get("priceMax") === "100",{timeout:60_000});
    const button = page.getByRole("button",{name:"Book Now",exact:true}).first();
    await expect(button).toBeEnabled();
    const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/hotels/book" && value.request().method() === "POST", {timeout:60_000});
    await button.click();
    release();
    const booked = await response;
    expect(booked.status()).toBe(201);
    const body: unknown = await booked.json();
    if (!body || typeof body !== "object" || !("reservation" in body) || !body.reservation || typeof body.reservation !== "object" || !("id" in body.reservation) || typeof body.reservation.id !== "number") throw new Error("Missing reservation id");
    reservationId = body.reservation.id;
    expect((await refreshed).status()).toBe(200);
    await expect(page.getByText("Your stay is reserved",{exact:true})).toBeVisible();
    await expect(page).not.toHaveURL(/auth\/login/);
  } finally {
    release();
    if (reservationId !== undefined) expect((await page.request.delete("/api/hotels/book?reservationId=" + reservationId, {headers:{Authorization:"Bearer " + accessToken}})).status()).toBe(200);
  }
});
