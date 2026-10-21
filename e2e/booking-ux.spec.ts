import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync } from "node:fs";

function stayFixture() {
  const value: unknown = JSON.parse(readFileSync("test-results/fixture.json","utf8"));
  if (!value || typeof value !== "object" || !("checkIn" in value) || typeof value.checkIn !== "string" || !("checkOut" in value) || typeof value.checkOut !== "string") throw new Error("Invalid stay fixture");
  return {checkIn:value.checkIn,checkOut:value.checkOut};
}

async function screenshot(page: Page, name: string) {
  mkdirSync("test-results/ux-review",{recursive:true});
  await page.screenshot({path:`test-results/ux-review/${name}.png`});
}

test("date-only hotel search, applied results, URL restoration and empty-state actions", async ({page}) => {
  const stay = stayFixture();
  const errors: string[] = [];
  page.on("pageerror",error=>errors.push(error.message));
  await page.setViewportSize({width:390,height:844});
  await page.goto("/hotels");
  await expect(page.getByRole("button",{name:"Search stays",exact:true})).toBeEnabled();
  await expect(page.getByRole("heading",{name:"Browse hotels",exact:true})).toBeVisible();
  await expect(page.getByText("Select dates for availability",{exact:false})).toHaveCount(0);
  await page.getByRole("button",{name:"Choose dates",exact:true}).first().click();
  await expect(page.getByLabel("Check-in:",{exact:true})).toBeFocused();
  await screenshot(page,"hotel-browse-mobile");
  await page.getByLabel("Check-in:",{exact:true}).fill(stay.checkIn);
  await page.getByLabel("Check-out:",{exact:true}).fill(stay.checkOut);
  await expect(page.getByRole("button",{name:"Check availability",exact:true}).first()).toBeEnabled();
  const available = page.waitForResponse(response=>new URL(response.url()).pathname === "/api/hotels" && new URL(response.url()).searchParams.get("checkIn") === stay.checkIn);
  await page.getByRole("button",{name:"Check availability",exact:true}).first().click();
  expect((await available).status()).toBe(200);
  await expect(page.getByRole("button",{name:"Book Now",exact:true}).first()).toBeEnabled();
  await expect(page.getByRole("combobox",{name:"Destination",exact:true})).toHaveValue("");
  await expect(page).toHaveURL(new RegExp("checkIn=" + stay.checkIn));
  await page.reload();
  await expect(page.getByRole("button",{name:"Book Now",exact:true}).first()).toBeEnabled();
  await expect(page.getByLabel("Check-out:",{exact:true})).toHaveValue(stay.checkOut);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("heading",{name:"Available stays",exact:true}).scrollIntoViewIfNeeded();
  await screenshot(page,"hotel-availability-desktop");
  await page.getByRole("combobox",{name:"Destination",exact:true}).fill("Atlanta");
  await expect(page.getByRole("region",{name:"Hotel results"}).getByText(/All destinations/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Book Now",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Update results",exact:true}).click();
  await expect(page.getByRole("heading",{name:"No stays match your search"})).toBeVisible();
  await screenshot(page,"hotel-empty-desktop");
  await page.getByRole("button",{name:"Browse all hotels",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Browse hotels",exact:true})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("combobox",{name:"Destination",exact:true})).toHaveValue("Atlanta");
  await expect(page.getByRole("heading",{name:"No stays match your search"})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button",{name:"Book Now",exact:true}).first()).toBeEnabled();
  const violations = (await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()).violations;
  expect(violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("hotel search failure retries the requested filters and clear filters retains stay dates", async ({page}) => {
  const stay = stayFixture();
  await page.goto("/hotels?"+new URLSearchParams({...stay,city:"Toronto"}));
  await expect(page.getByRole("button",{name:"Book Now",exact:true}).first()).toBeEnabled();
  await page.getByText("Refine your stay",{exact:true}).press("Enter");
  await page.getByLabel("Hotel name",{exact:true}).fill("No Such Synthetic Hotel");
  await page.getByRole("button",{name:"Search stays",exact:true}).click();
  await expect(page.getByRole("heading",{name:"No stays match your search"})).toBeVisible();
  await page.getByRole("button",{name:"Clear filters",exact:true}).last().click();
  await expect(page.getByRole("button",{name:"Book Now",exact:true}).first()).toBeEnabled();
  await expect(page.getByLabel("Check-in:",{exact:true})).toHaveValue(stay.checkIn);
  await page.route("**/api/hotels?**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Search temporarily unavailable."})}),{times:1});
  await page.getByRole("button",{name:"Search stays",exact:true}).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Search temporarily unavailable.");
  await page.getByRole("button",{name:"Retry search",exact:true}).click();
  await expect(page.getByRole("button",{name:"Book Now",exact:true}).first()).toBeEnabled();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp("city=Toronto"));
});

test("an invalid date in a shared hotel URL reports validation without a page crash", async ({page}) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/hotels?checkIn=not-a-date&checkOut=2028-03-01");
  await expect(page.getByRole("heading", {name:"Find your place to stay"})).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", {name:"Book Now", exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const tripType of ["one-way","round-trip"] as const) {
  test(`${tripType} flight confirmation has reservation and itinerary actions`,async ({page})=>{
    test.setTimeout(150_000);
    const stay = stayFixture();
    const email = `e2e-${tripType}-ux@example.invalid`;
    const password = "synthetic-ux-test-password";
    expect((await page.request.post("/api/auth/register",{data:{email,password,firstName:"Synthetic",lastName:"Traveller"}})).status()).toBe(201);
    const login = await page.request.post("/api/auth/login",{data:{email,password}});
    expect(login.status()).toBe(200);
    const identity: unknown = await login.json();
    if (!identity || typeof identity !== "object" || !("accessToken" in identity) || typeof identity.accessToken !== "string") throw new Error("Missing test token");
    const token = identity.accessToken;
    const errors: string[] = [];
    page.on("pageerror",error=>errors.push(error.message));
    await page.setViewportSize({width:1440,height:1000});
    await page.goto("/flights?"+new URLSearchParams({origin:"YYZ",destination:"LHR",date:stay.checkIn,returnDate:stay.checkOut,tripType}));
    await expect(page.getByRole("heading",{name:"Outbound Flights",exact:true})).toBeVisible();
    let reservationId: number | undefined;
    try {
      if (tripType === "round-trip") {
        await page.getByRole("button",{name:/^Select flight: outbound/}).first().click();
        const inbound = page.getByRole("button",{name:/^Select flight: return/}).first();
        if (!await inbound.isVisible()) await page.getByRole("group",{name:"Flight direction"}).getByRole("button",{name:/^Return/}).click();
        await inbound.click();
      }
      const response = page.waitForResponse(value=>new URL(value.url()).pathname === "/api/flights/book" && value.request().method() === "POST",{timeout:60_000});
      await page.getByRole("button",{name:tripType === "one-way" ? /Book One.Way/ : "Book Round Trip"}).first().click();
      const booked = await response;
      expect(booked.status()).toBe(201);
      const data: unknown = await booked.json();
      if (!data || typeof data !== "object" || !("reservationId" in data) || typeof data.reservationId !== "number") throw new Error("Missing reservation id");
      reservationId = data.reservationId;
      const confirmation = page.getByRole("status",{name:"Reservation confirmed"});
      await expect(confirmation).toBeVisible();
      await confirmation.evaluate(element=>element.scrollIntoView({block:"start"}));
      expect(await confirmation.evaluate(element=>element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(31);
      await expect(confirmation.getByRole("link",{name:"View reservation",exact:true})).toHaveAttribute("href",`/user/flight-bookings/${reservationId}`);
      await expect(confirmation.getByRole("link",{name:"Build an itinerary",exact:true})).toHaveAttribute("href","/itineraries/new");
      if (tripType === "round-trip") await page.setViewportSize({width:390,height:844});
      await confirmation.evaluate(element=>element.scrollIntoView({block:"center"}));
      await screenshot(page,`flight-${tripType}-success-${tripType === "one-way" ? "desktop" : "mobile"}`);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const violations = (await new AxeBuilder({page}).include(".reservation-success").analyze()).violations;
      expect(violations).toEqual([]);
      await confirmation.getByRole("link",{name:"View reservation",exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/user/flight-bookings/${reservationId}$`));
      expect(errors).toEqual([]);
    } finally {
      if (reservationId !== undefined) expect((await page.request.delete(`/api/user/flight-bookings/${reservationId}`,{headers:{Authorization:`Bearer ${token}`}})).status()).toBe(200);
    }
  });
}

test("booking progress offers both flight and hotel destinations", async ({page})=>{
  await page.goto("/flights");
  const progress = page.getByRole("navigation",{name:"Booking progress"});
  await progress.getByRole("link",{name:"Stays",exact:true}).click();
  await expect(page).toHaveURL(/\/hotels$/);
  await page.getByRole("navigation",{name:"Booking progress"}).getByRole("link",{name:"Flights",exact:true}).click();
  await expect(page).toHaveURL(/\/flights$/);
});
