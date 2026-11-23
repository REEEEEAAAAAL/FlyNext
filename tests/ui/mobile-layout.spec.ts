import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const day = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10);
};
const checkIn = day(2);
const checkOut = day(4);
const query = new URLSearchParams({ checkIn, checkOut });
const photo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='400'%3E%3Crect width='640' height='400' fill='%23b7dadc'/%3E%3C/svg%3E";
const room = { id: 1, name: "Harbour King Room", pricePerNight: 180, currentAvailability: 8, amenities: "Wi-Fi, breakfast and harbour views", images: [] };
const hotel = { id: 1, name: "Harbour View Hotel", address: "123 Example Avenue", location: "Toronto", starRating: 4, images: [photo], roomTypes: [{ ...room, availableRooms: 8, stayTotal: 360 }] };
const departure = { goAirport: "YYZ", goDate: `${checkIn}T08:00:00Z` };
const arrival = { goAirport: "LHR", goDate: `${checkIn}T15:00:00Z` };
const flightBooking = { id: 1, afsBookingId: "SYNTHETIC-REFERENCE", status: "PENDING", price: 450, departure, arrival, createdAt: `${day(0)}T12:00:00Z` };
const stay = { id: 1, hotel, roomType: room, checkIn, checkOut, price: 360, status: "PENDING" };
const order = { id: 1, totalPrice: 810, status: "DRAFT", bookingDate: `${day(0)}T12:00:00Z`, flight: flightBooking, hotel: stay };
const stayBooking = { ...stay, period: { checkIn, checkOut }, totalPrice: 360 };
const flightQuery = new URLSearchParams({ origin: "YYZ", destination: "LHR", date: checkIn, returnDate: checkOut, tripType: "round-trip" });

async function installFixtures(page: Page) {
  const unexpected: string[] = [];
  const token = `synthetic.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url")}.synthetic`;
  await page.context().route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;
    if (path === "/api/auth/refresh") body = { accessToken: token };
    else if (path === "/api/user") body = { user: { id: 1, firstName: "Alex", lastName: "Traveller", email: "alex@example.invalid", IsHotelOwner: true } };
    else if (path === "/api/notifications/unread-count") body = { unreadCount: 0 };
    else if (path === "/api/notifications") body = { notifications: [], hasOlderUnread: false };
    else if (path.endsWith("/reservations")) body = { reservations: [] };
    else if (path === "/api/hotels/1/room-types/1") body = { roomType: room, availabilityRecords: Array.from({ length: 60 }, (_, i) => ({ date: `${day(i)}T00:00:00Z`, availability: 8 })) };
    else if (path === "/api/hotels/1") body = { hotel };
    else if (path === "/api/hotels/1/room-types") body = { roomTypes: [room] };
    else if (path === "/api/hotels" || path === "/api/hotels/owner") body = { hotels: [hotel] };
    else if (path === "/api/itineraries/1") body = order;
    else if (path === "/api/itineraries") body = { itineraries: [order] };
    else if (path === "/api/user/flight-bookings/1") body = { booking: flightBooking };
    else if (path === "/api/user/flight-bookings") body = { bookings: [flightBooking] };
    else if (path === "/api/user/hotel-bookings/1") body = { booking: { ...stay, room: { type: room.name, amenities: room.amenities }, createdAt: order.bookingDate } };
    else if (path === "/api/user/hotel-bookings") body = { bookings: [stayBooking] };
    else if (path === "/api/hotels/book") body = { reservation: { id: 1 } };
    else if (path === "/api/flights/book") body = { reservationId: 1 };
    else if (path === "/api/flights/search") {
      const inbound = url.searchParams.get("origin") === "LHR";
      body = [{ legs: 1, flights: [{ id: inbound ? "return" : "outbound", flightNumber: "FN101", price: 450, durationMinutes: 420, availableSeats: 8, departureTime: `${inbound ? checkOut : checkIn}T08:00:00Z`, arrivalTime: `${inbound ? checkOut : checkIn}T15:00:00Z`, airline: { code: "FN", name: "FlyNext Demo Airlines" }, origin: { code: inbound ? "LHR" : "YYZ", name: "Departure airport", city: "Toronto", country: "Canada" }, destination: { code: inbound ? "YYZ" : "LHR", name: "Arrival airport", city: "London", country: "United Kingdom" } }] }];
    } else if (path === "/api/locations/cities") body = { cities: [{ id: 1, name: "Toronto", country: "Canada" }] };
    else if (path === "/api/locations/airports") body = { airports: [{ id: 1, code: "YYZ", name: "Toronto Pearson International Airport", country: "Canada" }] };
    else {
      unexpected.push(`${route.request().method()} ${path}`);
      await route.fulfill({ status: 500, json: { error: "Unconfigured UI fixture" } });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.context().route("https://**", route => route.abort());
  return unexpected;
}

async function checkBounds(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const issues = await page.locator('input[type="date"]:visible').evaluateAll(inputs => inputs.flatMap(input => {
    const bounds = input.getBoundingClientRect();
    const parent = input.parentElement;
    if (!parent) return ["Missing date container"];
    const box = parent.getBoundingClientRect();
    const style = getComputedStyle(input);
    return bounds.left < box.left - 1 || bounds.right > box.right + 1 || bounds.width < 170 || parseFloat(style.fontSize) < 16 || input.scrollWidth > input.clientWidth + 1
      ? [`${input.id || "stay date"}: ${bounds.width}px, container ${box.width}px, font ${style.fontSize}`] : [];
  }));
  expect(issues).toEqual([]);
  await checkFooter(page);
}

async function checkFooter(page: Page) {
  const footer = page.locator(".site-footer");
  const hasHostLink = !["/", "/hotels/owner", "/hotels/new", "/hotels/1/edit", "/hotels/1/room-types/new", "/hotels/1/room-types/1/edit"].includes(new URL(page.url()).pathname);
  const hostLink = footer.getByRole("link", { name: "Host workspace", exact: true });
  if (hasHostLink) {
    await expect(hostLink).toHaveAttribute("href", "/hotels/owner");
  } else {
    await expect(hostLink).toHaveCount(0);
  }
  const links = await footer.locator("a").evaluateAll(items => items.map(item => {
    const box = item.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  }));
  await expect(footer.getByRole("link", { name: "FlyNext", exact: true })).toHaveAttribute("href", "/");
  await expect(footer.getByRole("link", { name: "FlyNext source code on GitHub" })).toHaveAttribute("href", "https://github.com/REEEEEAAAAAL/FlyNext");
  expect(links).toHaveLength(hasHostLink ? 3 : 2);
  expect(Math.max(...links.map(link => link.top))).toBeLessThan(Math.min(...links.map(link => link.bottom)));
  expect(links.every(link => link.left >= 0 && link.right <= page.viewportSize()!.width)).toBe(true);
  await expect(footer).not.toContainText("A portfolio travel demo.");
}

test("home card colors, footer spacing and the existing host entry on desktop and mobile", async ({ page }) => {
  const unexpected = await installFixtures(page);
  for (const viewport of [{ width: 320, height: 844 }, { width: 901, height: 844 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await checkBounds(page);

      const styles = await page.evaluate(() => {
        const lastCard = document.querySelector(".host-banner")!;
        const footer = document.querySelector(".site-footer")!;
        return {
          gap: footer.getBoundingClientRect().top - lastCard.getBoundingClientRect().bottom,
          steps: Array.from(document.querySelectorAll(".step-card"), (card) => getComputedStyle(card).backgroundColor),
          host: getComputedStyle(lastCard).backgroundColor,
          surface: getComputedStyle(document.querySelector(".site-header")!).backgroundColor,
          canvas: getComputedStyle(document.body).backgroundColor,
        };
      });
      expect(styles.gap).toBeGreaterThanOrEqual(24);
      expect(styles.gap).toBeLessThanOrEqual(40);
      expect(styles.steps).toEqual(Array(3).fill(styles.surface));
      expect(styles.host).not.toBe(styles.surface);
      expect(styles.host).not.toBe(styles.canvas);

      const primary = page.getByRole("navigation", { name: "Primary", exact: true });
      await expect(primary.getByRole("link", { name: "Host workspace", exact: true })).toHaveCount(0);
      await page.getByRole("link", { name: "Open host workspace", exact: true }).click();
      await expect(page).toHaveURL(/\/hotels\/owner$/);
      await expect(page.getByRole("heading", { name: "Your host workspace" })).toBeVisible();
      await expect(primary.getByRole("link", { name: "Host workspace", exact: true })).toHaveCount(0);
      await checkFooter(page);
      if (viewport.width >= 901) {
        await primary.getByRole("link", { name: "Stays", exact: true }).click();
        await expect(page).toHaveURL(/\/hotels$/);
        await checkFooter(page);
      }
    }
  }
  expect(unexpected).toEqual([]);
});

test("the signed-out mobile menu shows travel links while sign-in stays in the header", async ({ page }) => {
  const unexpected = await installFixtures(page);
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 401, json: { error: "Unauthorized" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu.getByRole("link")).toHaveText(["Flights", "Stays", "My trips"]);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/auth/login");
  expect(unexpected).toEqual([]);
});

test("the signed-in mobile menu shows only travel links", async ({ page }) => {
  const unexpected = await installFixtures(page);
  await page.goto("/");
  const accountButton = page.getByRole("button", { name: "My account" });
  await expect(accountButton).toBeVisible();
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await toggle.click();
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu.getByRole("link")).toHaveText(["Flights", "Stays", "My trips"]);
  await menu.getByRole("link", { name: "Stays", exact: true }).click();
  await expect(page).toHaveURL(/\/hotels$/);
  await expect(menu).toHaveCount(0);
  await checkFooter(page);

  await toggle.click();
  await expect(menu.getByRole("link", { name: "Stays", exact: true })).toHaveAttribute("aria-current", "page");
  await accountButton.click();
  await expect(page.getByRole("navigation", { name: "Account", exact: true }).getByRole("link", { name: "Host workspace", exact: true })).toHaveAttribute("href", "/hotels/owner");
  expect(unexpected).toEqual([]);
});

test("the browser tab icon uses the FlyNext paper plane", async ({ page }) => {
  const unexpected = await installFixtures(page);
  await page.goto("/");
  const icon = page.locator('head link[rel="icon"]');
  await expect(icon).toHaveAttribute("href", /^\/icon\.svg(?:\?|$)/);
  const href = await icon.getAttribute("href");
  const response = await page.request.get(new URL(href!, page.url()).href);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  const svg = await response.text();
  const brandPaths = await page.locator(".brand svg path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
  expect(brandPaths).toHaveLength(2);
  for (const path of brandPaths) expect(svg).toContain(`d="${path}"`);
  expect(unexpected).toEqual([]);
});

test("notification read actions refresh the badge and can be retried after a failure", async ({ page }) => {
  const unexpected = await installFixtures(page);
  const unread = new Set([1, 2]);
  let bulkAttempts = 0;
  await page.route("**/api/notifications/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/notifications/unread-count") {
      return route.fulfill({ json: { unreadCount: unread.size } });
    }
    expect(route.request().method()).toBe("PUT");
    if (pathname === "/api/notifications/1/read") {
      unread.delete(1);
      return route.fulfill({ json: { notification: { id: 1, isRead: true } } });
    }
    expect(pathname).toBe("/api/notifications/read-all");
    if (++bulkAttempts === 1) {
      return route.fulfill({ status: 503, json: { error: "Try again in a moment" } });
    }
    unread.clear();
    return route.fulfill({ json: { updatedCount: 1 } });
  });
  await page.route("**/api/notifications", (route) => route.fulfill({ json: {
    notifications: [{ id: 1, content: "Trip changed", isRead: !unread.has(1), createdAt: "2026-01-01T12:00:00Z" }],
    hasOlderUnread: unread.has(2),
  } }));

  await page.goto("/notifications");
  const badge = page.getByRole("link", { name: /^Notifications/ });
  const single = page.getByRole("button", { name: "Mark as Read: Trip changed" });
  const bulk = page.getByRole("button", { name: "Mark all as read" });
  const error = page.getByRole("main").getByRole("alert");
  await expect(badge).toHaveAccessibleName("Notifications, 2 unread");
  await single.click();
  await expect(single).toHaveCount(0);
  await expect(badge).toHaveAccessibleName("Notifications, 1 unread");

  await bulk.click();
  await expect(error).toHaveText("Try again in a moment");
  await expect(bulk).toBeEnabled();
  await expect(badge).toHaveAccessibleName("Notifications, 1 unread");

  await bulk.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "All notifications marked as read" })).toBeVisible();
  await expect(badge).toHaveAccessibleName("Notifications");
  await expect(bulk).toBeDisabled();
  await expect(bulk).toBeFocused();
  await expect(error).toHaveCount(0);
  await page.reload();
  await expect(bulk).toBeDisabled();
  await expect(single).toHaveCount(0);
  expect(bulkAttempts).toBe(2);
  expect(unexpected).toEqual([]);
});

for (const width of [320, 360, 375, 390, 430]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${width}px ${theme}: mobile pages and native dates`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const unexpected = await installFixtures(page);
      const routes = ["/", `/flights?${flightQuery}`, `/hotels?${query}`, `/hotels/1?${query}`, `/hotels/1/room-types/1?${query}`, "/auth/login", "/auth/register", "/itineraries", "/itineraries/1", "/itineraries/new", "/user/flight-bookings", "/user/flight-bookings/1", "/user/hotel-bookings", "/user/hotel-bookings/1", "/checkout?itineraryId=1", "/hotels/owner", "/hotels/new", "/hotels/1/edit", "/hotels/1/room-types/new", "/hotels/1/room-types/1/edit"];
      for (const path of routes) {
        await test.step(path, async () => {
          await page.goto(path);
          await page.waitForLoadState("networkidle");
          await expect(page.locator("main h1").first()).toBeVisible();
          await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
          await checkBounds(page);
          if (path.startsWith("/flights?")) {
            await page.getByRole("button", { name: /^Select flight: outbound/ }).first().click();
            await page.getByRole("group", { name: "Flight direction" }).getByRole("button", { name: /^Return/ }).click();
            await page.getByRole("button", { name: /^Select flight: return/ }).first().click();
            await page.getByRole("button", { name: "Book Round Trip" }).click();
            await expect(page.getByRole("status", { name: "Reservation confirmed" })).toBeVisible();
            await checkBounds(page);
          } else if (path.startsWith("/hotels?")) {
            await page.getByRole("button", { name: "Book Now", exact: true }).first().click();
            await expect(page.getByRole("status", { name: "Reservation confirmed" })).toBeVisible();
            await checkBounds(page);
          } else if (path.endsWith("/room-types/1/edit")) {
            await page.getByLabel("Check-In:", { exact: true }).fill(checkIn);
            await page.getByLabel("Check-Out:", { exact: true }).fill(checkOut);
            await checkBounds(page);
          }
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
          await page.waitForLoadState("networkidle");
          if (width === 320) await page.screenshot({ path: testInfo.outputPath(`${path.split("?")[0].replaceAll("/", "_") || "home"}.png`), fullPage: true });
        });
      }
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("mobile navigation, suggestions, gallery and reservation confirmations", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const unexpected = await installFixtures(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/flights?${flightQuery}`);
  await page.getByRole("button", { name: /^Select flight: outbound/ }).first().click();
  await page.getByRole("group", { name: "Flight direction" }).getByRole("button", { name: /^Return/ }).click();
  await page.getByRole("button", { name: /^Select flight: return/ }).first().click();
  await page.getByRole("button", { name: "Book Round Trip" }).click();
  await expect(page.getByRole("status", { name: "Reservation confirmed" })).toBeVisible();
  await checkBounds(page);
  await page.waitForLoadState("networkidle");
  await page.goto(`/hotels?${query}`);
  await page.getByRole("button", { name: "Book Now", exact: true }).first().click();
  await expect(page.getByRole("status", { name: "Reservation confirmed" })).toBeVisible();
  await checkBounds(page);
  await page.waitForLoadState("networkidle");
  await page.goto("/hotels/1");
  await page.getByRole("button", { name: /^View photo 1/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialog = await page.getByRole("dialog").boundingBox();
  expect(dialog && dialog.x >= 0 && dialog.x + dialog.width <= 320).toBe(true);
  await page.getByRole("button", { name: "Close photos" }).click();
  const calendar = page.locator(".nightly-calendar").first();
  await calendar.locator("summary").click();
  await expect(calendar.getByRole("table").first()).toBeVisible();
  await checkBounds(page);
  await calendar.locator("summary").click();
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await checkBounds(page);
  await page.getByRole("button", { name: "Toggle navigation" }).press("Escape");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
  await page.goto("/flights");
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox", { name: "From", exact: true }).fill("Tor");
  await expect(page.getByRole("listbox", { name: "From suggestions" })).toBeVisible();
  await checkBounds(page);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("date padding comparison keeps native controls and reports empty and selected widths", async ({ page }) => {
  await page.setContent(readFileSync("tests/ui/fixtures/date-input-check.html", "utf8"));
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const variant of ["baseline", "zero", "appearance", "candidate"]) {
      const group = page.locator(`section.${variant}`);
      const fields = group.locator("input");
      const textWidth = (await fields.first().boundingBox())!.width;
      const dates = group.locator('input[type="date"]');
      for (const date of await dates.all()) {
        if (variant === "zero" || variant === "candidate") {
          expect((await date.boundingBox())!.width).toBeCloseTo(textWidth, 0);
          expect(await date.evaluate(input => getComputedStyle(input).paddingInlineStart)).toBe("0px");
          expect(await date.evaluate(input => getComputedStyle(input).appearance)).toBe("auto");
        }
        await date.fill(checkIn);
        await expect(date).toHaveValue(checkIn);
        if (variant === "zero" || variant === "candidate") expect((await date.boundingBox())!.width).toBeCloseTo(textWidth, 0);
        await date.fill("");
      }
    }
  }
  console.log(await page.locator("#browser").textContent());
  console.log(await page.locator("section").evaluateAll(groups => groups.map(group => ({ variant: group.className, measurements: group.querySelector("output")?.textContent }))));
});

test("all application date controls fit before and after choosing dates", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const unexpected = await installFixtures(page);
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/flights?tripType=round-trip", "/hotels", "/hotels/1", "/hotels/1/room-types/1", "/hotels/1/room-types/1/edit"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const dates = page.locator('input[type="date"]:visible');
      await expect(dates).toHaveCount(2);
      await checkBounds(page);
      await dates.nth(0).fill(checkIn);
      await dates.nth(1).fill(checkOut);
      await expect(dates.nth(0)).toHaveValue(checkIn);
      await expect(dates.nth(1)).toHaveValue(checkOut);
      await checkBounds(page);
      for (const date of await dates.all()) {
        expect(await date.evaluate(input => getComputedStyle(input).appearance)).toBe("auto");
        await date.fill("");
      }
      await checkBounds(page);
      await page.waitForLoadState("networkidle");
    }
  }
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("a short touch tap completes airport and city prefixes", async ({ page }) => {
  const unexpected = await installFixtures(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [320, 360, 375, 390, 430]) {
   await page.setViewportSize({ width, height: 844 });
   for (const [path, label, prefix, completed] of [["/flights", "From", "yy", "YYZ"], ["/flights", "To", "yy", "YYZ"], ["/hotels", "Destination", "To", "Toronto"]]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const input = page.getByRole("combobox", { name: label, exact: true });
    await input.fill(prefix);
    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    const field = await input.boundingBox();
    const list = await page.getByRole("listbox", { name: label + " suggestions" }).boundingBox();
    if (!field || !list) throw new Error("Expected visible location field and suggestions");
    const gap = list.y - (field.y + field.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(4);
    await option.tap();
    await expect(input).toHaveValue(completed);
    await expect(input).toBeFocused();
    await expect(page.getByRole("listbox", { name: `${label} suggestions` })).toBeHidden();
    if (path === "/flights") {
      const suggestions = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === "/api/locations/airports" && url.searchParams.get("q") === "LHR";
      });
      await page.getByRole("combobox", { name: label === "From" ? "To" : "From", exact: true }).fill("LHR");
      await (await suggestions).finished();
      await page.getByLabel("Departure date:", { exact: true }).fill(checkIn);
    }
    const request = page.waitForRequest(request => {
      const url = new URL(request.url());
      return path === "/flights" ? url.pathname === "/api/flights/search" : url.pathname === "/api/hotels";
    });
    await page.getByRole("button", { name: path === "/flights" ? "Search flights" : "Search stays", exact: true }).click();
    const search = new URL((await request).url()).searchParams;
    expect(search.get(path === "/hotels" ? "city" : label === "From" ? "origin" : "destination")).toBe(completed);
    await page.waitForLoadState("networkidle");
   }
  }
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("location options retain mouse, keyboard and touch scrolling behavior", async ({ page }) => {
  const unexpected = await installFixtures(page);
  await page.route("**/api/locations/airports?**", route => route.fulfill({ json: { airports: Array.from({ length: 24 }, (_, index) => ({ id: index + 1, code: `Y${index.toString().padStart(2, "0")}`, name: `Synthetic airport ${index + 1}`, country: "Canada" })) } }));
  await page.goto("/flights");
  await page.waitForLoadState("networkidle");
  const input = page.getByRole("combobox", { name: "From", exact: true });
  await input.fill("yy");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(input).toHaveValue("Y00");
  await expect(input).toBeFocused();
  await input.fill("yy");
  await expect(page.getByRole("option").first()).toBeVisible();
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("Y01");
  await input.fill("yy");
  const first = page.getByRole("option").first();
  await expect(first).toBeVisible();
  await first.dispatchEvent("pointermove", { pointerType: "touch", pointerId: 1 });
  await expect(first).toHaveAttribute("aria-selected", "false");
  await expect(input).toHaveValue("yy");
  const list = page.getByRole("listbox", { name: "From suggestions" });
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("option").last()).toBeInViewport();
  await page.getByRole("option").last().tap();
  await expect(input).toHaveValue("Y23");
  await input.fill("yy");
  await expect(list).toBeVisible();
  await input.press("Escape");
  await expect(list).toBeHidden();
  expect(unexpected).toEqual([]);
});
