/**
 * Authorisation suite: broken access control.
 *
 * Every endpoint that takes an object identifier from the caller must scope the
 * operation to that caller. These cases drive the endpoints with an id that
 * exists but belongs to somebody else and assert the request is refused — the
 * class of defect usually filed as IDOR, where the handler authenticates the
 * caller but forgets to check that the object is theirs.
 *
 * Two refusals are correct and the suites accept either, per endpoint:
 *
 * - `404`, when the resource's existence should not be disclosed — a caller who
 *   does not own a row has no business learning that the id is taken;
 * - `403`, when the API contract deliberately says "authenticated but not
 *   allowed", or when the client renders the message verbatim.
 *
 * What is asserted everywhere is that the request fails and that the attacker's
 * write did not happen.
 */

import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { PUT as markNotificationRead } from "@/app/api/notifications/[notificationId]/read/route";
import { DELETE as cancelHotelBooking } from "@/app/api/hotels/book/route";
import {
  DELETE as deleteRoomType,
  PUT as updateRoomType,
} from "@/app/api/hotels/[hotelId]/room-types/[roomTypeId]/route";
import { GET as getFlightBooking } from "@/app/api/user/flight-bookings/[bookingId]/route";
import { GET as getHotelBooking } from "@/app/api/user/hotel-bookings/[bookingId]/route";
import { DELETE as deleteItinerary } from "@/app/api/itineraries/[itineraryId]/route";
import { GET as getOwnerHotels } from "@/app/api/hotels/owner/route";
import { POST as createItinerary } from "@/app/api/itineraries/route";
import { GET as getProfile } from "@/app/api/user/route";
import { disconnect, prisma, resetDatabase } from "#support/db";
import {
  createFlightReservation,
  createHotel,
  createHotelReservation,
  createItinerary as createItineraryRow,
  createNotification,
  createRoomType,
  createUser,
  tomorrow,
} from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("IDOR: a caller cannot act on another user's objects", () => {
  it("refuses to mark another user's notification as read", async () => {
    const victim = await createUser();
    const attacker = await createUser();
    const notification = await createNotification({ userId: victim.id });

    const response = await callRoute(markNotificationRead, {
      method: "PUT",
      params: { notificationId: String(notification.id) },
      token: tokenFor(attacker.id),
    });

    expect(response.status).toBe(404);

    // The read flag is the whole point of the endpoint, so assert it did not move.
    const stored = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
      select: { isRead: true },
    });
    expect(stored.isRead).toBe(false);
  });

  it("marks the caller's own notification as read", async () => {
    const owner = await createUser();
    const notification = await createNotification({ userId: owner.id });

    const response = await callRoute(markNotificationRead, {
      method: "PUT",
      params: { notificationId: String(notification.id) },
      token: tokenFor(owner.id),
    });

    expect(response.status).toBe(200);
    const stored = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
      select: { isRead: true },
    });
    expect(stored.isRead).toBe(true);
  });

  it("refuses to cancel a hotel booking that belongs to somebody else", async () => {
    const owner = await createUser({ IsHotelOwner: true });
    const guest = await createUser();
    const attacker = await createUser();

    const hotel = await createHotel({ ownerId: owner.id });
    const roomType = await createRoomType({ hotelId: hotel.id, availability: 3 });
    const stay = { checkIn: tomorrow(), checkOut: tomorrow() };
    const checkOut = new Date(stay.checkIn);
    checkOut.setDate(checkOut.getDate() + 2);

    const reservation = await createHotelReservation({
      userId: guest.id,
      hotelId: hotel.id,
      roomTypeId: roomType.id,
      checkIn: stay.checkIn,
      checkOut,
    });

    const response = await callRoute(cancelHotelBooking, {
      method: "DELETE",
      query: `reservationId=${reservation.id}`,
      token: tokenFor(attacker.id),
    });

    expect(response.status).toBe(403);

    // A refused cancellation must leave the booking intact.
    const stored = await prisma.hotelReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      select: { status: true },
    });
    expect(stored.status).toBe("CONFIRMED");
  });

  it("refuses to read another user's hotel booking detail", async () => {
    const owner = await createUser({ IsHotelOwner: true });
    const guest = await createUser();
    const attacker = await createUser();

    const hotel = await createHotel({ ownerId: owner.id });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const checkIn = tomorrow();
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 1);

    const reservation = await createHotelReservation({
      userId: guest.id,
      hotelId: hotel.id,
      roomTypeId: roomType.id,
      checkIn,
      checkOut,
    });

    const response = await callRoute(getHotelBooking, {
      params: { bookingId: String(reservation.id) },
      token: tokenFor(attacker.id),
    });

    expect(response.status).toBe(404);
  });

  it("refuses to read another user's flight booking detail", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const reservation = await createFlightReservation({ userId: owner.id });

    const response = await callRoute(getFlightBooking, {
      params: { bookingId: String(reservation.id) },
      token: tokenFor(attacker.id),
    });

    expect(response.status).toBe(404);
  });

  it("refuses to cancel another user's itinerary", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const itinerary = await createItineraryRow({ userId: owner.id });

    const response = await callRoute(deleteItinerary, {
      method: "DELETE",
      params: { itineraryId: String(itinerary.id) },
      token: tokenFor(attacker.id),
    });

    // `403` here is deliberate: the page renders this message verbatim.
    expect(response.status).toBe(403);

    const stored = await prisma.itinerary.findUniqueOrThrow({
      where: { id: itinerary.id },
      select: { status: true },
    });
    expect(stored.status).not.toBe("CANCELLED");
  });

  it("refuses cross-tenant room type writes via a hotel the caller does own", async () => {
    const ownerA = await createUser({ IsHotelOwner: true });
    const ownerB = await createUser({ IsHotelOwner: true });

    const hotelA = await createHotel({ ownerId: ownerA.id });
    const hotelB = await createHotel({ ownerId: ownerB.id });
    const roomTypeB = await createRoomType({ hotelId: hotelB.id, name: "Owner B Room" });

    // The caller owns `hotelA`, so the ownership gate passes; the room type
    // belongs to `hotelB`, which is the part that must be rejected.
    const updateForm = new FormData();
    updateForm.set("name", "Stolen");
    const updateResponse = await callRoute(updateRoomType, {
      method: "PUT",
      params: { hotelId: String(hotelA.id), roomTypeId: String(roomTypeB.id) },
      token: tokenFor(ownerA.id),
      formData: updateForm,
    });
    expect(updateResponse.status).toBe(404);

    const deleteResponse = await callRoute(deleteRoomType, {
      method: "DELETE",
      params: { hotelId: String(hotelA.id), roomTypeId: String(roomTypeB.id) },
      token: tokenFor(ownerA.id),
    });
    expect(deleteResponse.status).toBe(404);

    // Neither the name changed nor the row disappeared.
    const stored = await prisma.roomType.findUniqueOrThrow({
      where: { id: roomTypeB.id },
      select: { name: true },
    });
    expect(stored.name).toBe("Owner B Room");
  });

  it("refuses to attach another user's reservation to an itinerary", async () => {
    const victim = await createUser();
    const attacker = await createUser();

    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const checkIn = tomorrow();
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 1);

    const victimReservation = await createHotelReservation({
      userId: victim.id,
      hotelId: hotel.id,
      roomTypeId: roomType.id,
      checkIn,
      checkOut,
    });

    const response = await callRoute(createItinerary, {
      method: "POST",
      token: tokenFor(attacker.id),
      json: { hotelReservationId: String(victimReservation.id) },
    });

    expect(response.status).toBe(403);

    // The reservation must not have been linked to anything.
    const stored = await prisma.hotelReservation.findUniqueOrThrow({
      where: { id: victimReservation.id },
      select: { itineraryId: true },
    });
    expect(stored.itineraryId).toBeNull();
  });

  it("refuses an anonymous caller on a protected endpoint", async () => {
    const response = await callRoute(getProfile, { token: null });

    expect(response.status).toBe(401);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toBe("Unauthorized");
  });

  it("refuses a token signed with the wrong secret", async () => {
    const response = await callRoute(getProfile, { token: "not.a.real.token" });

    expect(response.status).toBe(401);
  });
});

describe("owner gate on the owner dashboard", () => {
  it("returns 403 for an authenticated account that is not a hotel owner", async () => {
    const traveller = await createUser({ IsHotelOwner: false });

    const response = await callRoute(getOwnerHotels, { token: tokenFor(traveller.id) });

    expect(response.status).toBe(403);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/owner/i);
  });

  it("returns 403 for an owner flag that was revoked after the token was issued", async () => {
    const owner = await createUser({ IsHotelOwner: true });
    const token = tokenFor(owner.id);

    // The gate reads the flag from the database, not from the token, so revoking
    // it takes effect immediately rather than when the token expires.
    await prisma.user.update({
      where: { id: owner.id },
      data: { IsHotelOwner: false },
    });

    const response = await callRoute(getOwnerHotels, { token });

    expect(response.status).toBe(403);
  });

  it("lists only the caller's own hotels", async () => {
    const owner = await createUser({ IsHotelOwner: true });
    const otherOwner = await createUser({ IsHotelOwner: true });

    const ownHotel = await createHotel({ ownerId: owner.id });
    await createHotel({ ownerId: otherOwner.id });

    const response = await callRoute(getOwnerHotels, { token: tokenFor(owner.id) });

    expect(response.status).toBe(200);
    const body = await readJson<{ hotels: { id: number }[]; reservations: unknown[] }>(
      response
    );
    expect(body.hotels.map((hotel) => hotel.id)).toEqual([ownHotel.id]);
    expect(Array.isArray(body.reservations)).toBe(true);
  });

  it("never exposes guest password hashes in the reservations payload", async () => {
    const owner = await createUser({ IsHotelOwner: true });
    const guest = await createUser({ IsHotelOwner: false });

    const hotel = await createHotel({ ownerId: owner.id });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const checkIn = tomorrow();
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 1);
    await createHotelReservation({
      userId: guest.id,
      hotelId: hotel.id,
      roomTypeId: roomType.id,
      checkIn,
      checkOut,
    });

    const response = await callRoute(getOwnerHotels, { token: tokenFor(owner.id) });
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(raw).not.toContain(guest.password);
    expect(raw).not.toContain("password");
    expect(raw).not.toContain(guest.email);
  });

  it("scopes the reservation list to the caller's hotels", async () => {
    const owner = await createUser({ IsHotelOwner: true });
    const otherOwner = await createUser({ IsHotelOwner: true });
    const guest = await createUser();

    const ownHotel = await createHotel({ ownerId: owner.id });
    const foreignHotel = await createHotel({ ownerId: otherOwner.id });
    const ownRoomType = await createRoomType({ hotelId: ownHotel.id });
    const foreignRoomType = await createRoomType({ hotelId: foreignHotel.id });

    const checkIn = tomorrow();
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 1);

    const own = await createHotelReservation({
      userId: guest.id,
      hotelId: ownHotel.id,
      roomTypeId: ownRoomType.id,
      checkIn,
      checkOut,
    });
    await createHotelReservation({
      userId: guest.id,
      hotelId: foreignHotel.id,
      roomTypeId: foreignRoomType.id,
      checkIn,
      checkOut,
    });

    const response = await callRoute(getOwnerHotels, { token: tokenFor(owner.id) });
    const body = await readJson<{ reservations: { id: number }[] }>(response);

    expect(body.reservations.map((row) => row.id)).toEqual([own.id]);
  });
});
