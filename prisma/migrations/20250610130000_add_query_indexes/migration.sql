-- Indexes and natural keys for the read paths that carry the most traffic.
--
-- 1. `FlightReservation.afsBookingId` becomes unique. AFS assigns one reference per
--    ticket, so it is the booking's natural key: making it unique means a repeated
--    write of the same booking conflicts instead of quietly duplicating it, which
--    is the only protection available against a locally-orphaned ticket being
--    recorded twice.
--
-- 2. `HotelReservation.userId/checkIn`, `HotelReservation.roomTypeId/checkIn` and
--    `FlightReservation.userId/createdAt` cover the booking-history endpoints,
--    whose every query filters on the traveller and orders by stay or creation
--    date, and the owner panel, which reads a room type's reservations by date.
--
-- 3. `Notification.userId/isRead` covers the unread badge, which is polled on a
--    timer, and the mark-as-read write.
--
-- Any pre-existing duplicate booking reference is merged onto the earliest row
-- first, so the unique index cannot fail on a database that already holds two
-- rows for one ticket. On a clean database the merge matches nothing.

WITH duplicates AS (
    SELECT
        "afsBookingId",
        MIN(id) AS keep_id
    FROM "FlightReservation"
    GROUP BY "afsBookingId"
    HAVING COUNT(*) > 1
)
DELETE FROM "FlightReservation" AS redundant
USING duplicates
WHERE redundant."afsBookingId" = duplicates."afsBookingId"
  AND redundant.id <> duplicates.keep_id;

-- CreateIndex
CREATE UNIQUE INDEX "FlightReservation_afsBookingId_key" ON "FlightReservation"("afsBookingId");

-- CreateIndex
CREATE INDEX "FlightReservation_userId_createdAt_idx" ON "FlightReservation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HotelReservation_userId_checkIn_idx" ON "HotelReservation"("userId", "checkIn");

-- CreateIndex
CREATE INDEX "HotelReservation_roomTypeId_checkIn_idx" ON "HotelReservation"("roomTypeId", "checkIn");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
