import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "pdf-lib";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync("test-results/fixture.json", "utf8")) as {hotelId:number;roomId:number;checkIn:string;checkOut:string};
const password = "synthetic-e2e-only-password";

async function login(page: Page, email: string, value=password) {
  await page.goto("/auth/login");
  await page.getByLabel("Email:", {exact:true}).fill(email);
  await page.getByLabel("Password:", {exact:true}).fill(value);
  await page.getByRole("button",{name:"Login",exact:true}).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

async function register(page:Page,email:string) {
  await page.goto("/auth/register");
  await page.getByLabel("Email:",{exact:true}).fill(email);
  await page.getByLabel("Password:",{exact:true}).fill(password);
  await page.getByLabel("First Name:",{exact:true}).fill("Synthetic");
  await page.getByLabel("Last Name:",{exact:true}).fill("Traveller");
  await page.getByRole("button",{name:"Register",exact:true}).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  await login(page,email);
}

test("visitor, registration, flight and hotel, combined trip, DEMO receipt, owner visibility and cancellation", async ({page, browser})=>{
  test.setTimeout(240_000);
  let phase = "visitor and registration";
  const runtimeErrors: {message:string;path:string;phase:string}[]=[];
  page.on("pageerror",error=>runtimeErrors.push({message:error.message,path:new URL(page.url()).pathname,phase}));
  await page.addInitScript(() => {
    window.addEventListener("error", () => {
      console.info("FlyNext runtime context", JSON.stringify({
        path: location.pathname,
        readyState: document.readyState,
        mainElement: document.querySelector("main")?.firstElementChild?.tagName ?? null,
        darkTheme: document.documentElement.classList.contains("dark"),
        accountExpanded: document.querySelector('[aria-controls="account-links"]')?.getAttribute("aria-expanded") ?? null,
      }));
    });
  });
  await page.goto(`/hotels/${fixture.hotelId}/room-types/${fixture.roomId}?checkIn=${fixture.checkIn}&checkOut=${fixture.checkOut}`);
  await page.getByRole("button",{name:"Reserve room",exact:true}).click();
  await expect(page).toHaveURL(/\/auth\/login\?next=/);
  await register(page,"e2e-traveller@example.invalid");
  phase = "first logout after registration";
  await test.step(phase, async () => {
    await page.goto("/auth/logout");
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("button",{name:"Login",exact:true})).toBeVisible();
  });
  phase = "login, booking and cancellation";
  await page.getByLabel("Email:",{exact:true}).fill("e2e-traveller@example.invalid");
  await page.getByLabel("Password:",{exact:true}).fill("intentionally-wrong");
  await page.getByRole("button",{name:"Login",exact:true}).click();
  await expect(page.locator("#login-error")).toBeVisible();
  await login(page,"e2e-traveller@example.invalid");
  await page.route("**/api/auth/refresh",async route=>{
    await new Promise(resolve=>setTimeout(resolve,1000));
    await route.continue();
  });
  await page.goto("/flights");
  await page.getByRole("combobox",{name:"From",exact:true}).fill("YYZ");
  await page.getByRole("combobox",{name:"To",exact:true}).fill("LHR");
  await page.getByLabel("Departure date:",{exact:true}).fill(fixture.checkIn);
  await page.getByRole("button",{name:"Search flights",exact:true}).click();
  const flightResponse=page.waitForResponse(response=>response.url().endsWith("/api/flights/book") && response.request().method()==="POST");
  await page.getByRole("button",{name:/Book One.Way/i}).first().click();
  const flight=await flightResponse;
  expect(flight.status()).toBe(201);
  const flightBooking=await flight.json();
  expect(flight.request().postDataJSON()).not.toHaveProperty("cardNumber");
  expect(flight.request().postDataJSON().passportNumber ?? "DEMO-PASSENGER").toBe("DEMO-PASSENGER");
  await page.goto(`/hotels?location=Toronto&checkIn=${fixture.checkIn}&checkOut=${fixture.checkOut}`);
  await expect(page.getByRole("button",{name:"My account",exact:true})).toBeVisible();
  await expect(page.getByText("FlyNext Synthetic Stay",{exact:true})).toBeVisible();
  await page.goto(`/hotels/${fixture.hotelId}/room-types/${fixture.roomId}?checkIn=${fixture.checkIn}&checkOut=${fixture.checkOut}`);
  await expect(page.getByText(/2 nights.*200.00 USD.*3 rooms available/)).toBeVisible();
  const bookingResponse=page.waitForResponse(response=>response.url().endsWith("/api/hotels/book") && response.request().method()==="POST");
  await page.getByRole("button",{name:"Reserve room",exact:true}).click();
  const booked=await bookingResponse;
  expect(booked.status()).toBe(201);
  const hotelBooking=(await booked.json()).reservation;
  await expect(page.getByText(/2 nights.*200.00 USD.*2 rooms available/)).toBeVisible();
  const ownerContext=await browser.newContext();
  const ownerPage=await ownerContext.newPage();
  await login(ownerPage,"e2e-owner@example.invalid","correct-horse-battery");
  await ownerPage.goto(`/hotels/${fixture.hotelId}/room-types/${fixture.roomId}/edit`);
  await expect(ownerPage.getByText(/Guest:.*Synthetic Traveller/)).toBeVisible();
  await ownerContext.close();
  await page.goto("/itineraries/new");
  await page.getByRole("combobox",{name:"Select a Flight Booking"}).selectOption(String(flightBooking.reservationId));
  await page.getByRole("combobox",{name:"Select a Hotel Booking"}).selectOption(String(hotelBooking.id));
  await page.getByRole("button",{name:"Create Itinerary",exact:true}).click();
  await expect(page).toHaveURL(/\/itineraries\/\d+/);
  const itineraryId=new URL(page.url()).pathname.split("/").pop();
  await page.goto(`/checkout?itineraryId=${itineraryId}`);
  await expect(page.getByText(/No money is charged/)).toBeVisible();
  const checkoutResponse=page.waitForResponse(response=>response.url().endsWith("/api/checkout") && response.request().method()==="POST");
  await page.getByRole("button",{name:"Confirm Demo Booking",exact:true}).click();
  const confirmed=await checkoutResponse;
  expect(confirmed.status()).toBe(200);
  expect(confirmed.request().postDataJSON()).toEqual({itineraryId:String(itineraryId),paymentMethod:"DEMO"});
  await expect(page.getByRole("button",{name:"Demo booking confirmed",exact:true})).toBeDisabled();
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download demo receipt PDF",exact:true}).click();
  const download=await downloadPromise;
  const pdfPath=await download.path();
  expect(readFileSync(pdfPath!).subarray(0,5).toString()).toBe("%PDF-");
  expect((await PDFDocument.load(readFileSync(pdfPath!))).getPageCount()).toBeGreaterThan(0);
  mkdirSync("docs/screenshots",{recursive:true});
  await page.screenshot({path:"docs/screenshots/demo-confirmation.png",fullPage:true});
  await page.goto(`/itineraries/${itineraryId}`);
  const cancel=page.getByRole("button",{name:"Cancel Entire Itinerary",exact:true});
  await cancel.click();
  const dialog=page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cancel).toBeFocused();
  await cancel.click();
  const cancellationResponse = page.waitForResponse(response => response.url().endsWith(`/api/itineraries/${itineraryId}`) && response.request().method() === "DELETE", {timeout:60_000});
  await dialog.getByRole("button",{name:"Yes, cancel everything",exact:true}).click();
  expect((await cancellationResponse).status()).toBe(200);
  await expect(cancel).toBeDisabled();
  await page.goto(`/hotels/${fixture.hotelId}/room-types/${fixture.roomId}?checkIn=${fixture.checkIn}&checkOut=${fixture.checkOut}`);
  await expect(page.getByText(/2 nights.*200.00 USD.*3 rooms available/)).toBeVisible();
  phase = "final logout after cancellation and inventory restoration";
  await test.step(phase, async () => {
    await page.goto("/auth/logout");
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("button",{name:"Login",exact:true})).toBeVisible();
  });
  expect(runtimeErrors).toEqual([]);
});

test("new owner creates a hotel and room then manages capacity", async ({page})=>{
  await register(page,"e2e-new-owner@example.invalid");
  await page.goto("/hotels/new");
  await page.getByLabel("Hotel Name:",{exact:true}).fill("Synthetic Owner Property");
  await page.getByLabel("Address:",{exact:true}).fill("1 Synthetic Demo Street");
  await page.getByPlaceholder("e.g., Toronto, ON",{exact:true}).fill("Toronto, Canada");
  const creation=page.waitForResponse(response=>response.url().endsWith("/api/hotels") && response.request().method()==="POST");
  await page.getByRole("button",{name:/Create Hotel/i}).click();
  const created=await creation;
  expect(created.status()).toBe(201);
  const {hotelId}=await created.json();
  await expect(page).toHaveURL(/\/hotels\/owner/);
  await expect(page.getByText("Synthetic Owner Property",{exact:true})).toBeVisible();
  await page.goto(`/hotels/${hotelId}/room-types/new`);
  await page.getByLabel("Room Type Name:",{exact:true}).fill("Synthetic Owner Suite");
  await page.getByLabel("Amenities:",{exact:true}).fill("Wi-Fi");
  await page.getByLabel("Price Per Night ($):",{exact:true}).fill("120");
  await page.getByLabel("Total Room Capacity:",{exact:true}).fill("4");
  await page.getByRole("button",{name:/Create Room Type/i}).click();
  await expect(page).toHaveURL(new RegExp(`/hotels/${hotelId}/edit`));
  await expect(page.getByText("Name: Synthetic Owner Suite",{exact:true})).toBeVisible();
  await page.getByRole("link").filter({hasText:"Name: Synthetic Owner Suite"}).click();
  await page.getByLabel("Total Room Capacity:",{exact:true}).fill("5");
  await page.getByRole("button",{name:"Update Room Type",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/hotels/${hotelId}/edit`));
  await expect(page.getByText("Configured capacity: 5",{exact:true})).toBeVisible();
});

for (const viewport of [{name:"desktop",width:1440,height:1000},{name:"tablet",width:768,height:1024},{name:"mobile",width:390,height:844}]) {
  for (const theme of ["light","dark"]) {
    test(`${viewport.name} ${theme}: navigation, accessibility, date selection and layout`,async ({page})=>{
      await page.setViewportSize({width:viewport.width,height:viewport.height});
      await page.addInitScript(value=>localStorage.setItem("theme",value),theme);
      const metrics=[];
      for (const path of ["/","/flights",`/hotels/${fixture.hotelId}/room-types/${fixture.roomId}?checkIn=${fixture.checkIn}&checkOut=${fixture.checkOut}`]) {
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        if (path==="/flights" && viewport.name==="desktop" && theme==="light") {
          const from=page.getByRole("combobox",{name:"From",exact:true});
          await from.fill("YYZ");
          await expect(page.getByRole("option",{name:/^YYZ/})).toBeVisible();
          await from.press("ArrowDown");
          await from.press("Enter");
          await expect(from).toHaveValue("YYZ");
        }
        if (path.includes("room-types")) await expect(page.getByRole("button",{name:"Reserve room",exact:true})).toBeEnabled();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
        const violations=(await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()).violations;
        expect(violations.map(row=>({id:row.id,impact:row.impact,nodes:row.nodes.map(node=>node.target)}))).toEqual([]);
        metrics.push(await page.evaluate(()=>{
          const navigation=performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          return {path:location.pathname,ttfb:navigation.responseStart-navigation.requestStart,domContentLoaded:navigation.domContentLoadedEventEnd};
        }));
      }
      await page.getByLabel("Check-out",{exact:true}).fill(fixture.checkIn);
      await expect(page.getByRole("button",{name:"Reserve room",exact:true})).toBeDisabled();
      await page.getByLabel("Check-out",{exact:true}).fill(fixture.checkOut);
      await page.getByRole("button",{name:"Check dates & availability",exact:true}).click();
      await expect(page.getByRole("button",{name:"Reserve room",exact:true})).toBeEnabled();
      mkdirSync("docs/screenshots",{recursive:true});
      await page.screenshot({path:`docs/screenshots/${viewport.name}-${theme}.png`,fullPage:true});
      writeFileSync(`test-results/${viewport.name}-${theme}-metrics.json`,JSON.stringify(metrics));
      await page.goto("/auth/login");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link",{name:"Skip to content",exact:true})).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main")).toBeFocused();
    });
  }
}
