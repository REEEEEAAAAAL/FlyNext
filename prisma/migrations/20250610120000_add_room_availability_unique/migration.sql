-- Enforce at most one availability row per room type per night.
--
-- The application treats `(roomTypeId, date)` as a natural key: the room-type
-- calendar, the booking flow's conditional decrement and the cancellation
-- release all address a single night. The unique index makes that key a database
-- guarantee rather than a convention the writers have to observe. Two rows for
-- one date would split the night across both records, so a booking could
-- decrement one of them while reads summed both, and more rooms than exist could
-- be sold.
--
-- Duplicate rows are merged first: their availability values are added up so the
-- nights already sold stay accounted for, and the newest row is kept. On a
-- database without duplicates the statement matches nothing and is a no-op.

WITH merged AS (
    SELECT
        "roomTypeId",
        date,
        SUM(availability)::integer AS total,
        MAX(id) AS keep_id
    FROM "RoomAvailabilityRecord"
    GROUP BY "roomTypeId", date
    HAVING COUNT(*) > 1
),
updated AS (
    UPDATE "RoomAvailabilityRecord" AS target
    SET availability = merged.total
    FROM merged
    WHERE target.id = merged.keep_id
    RETURNING target.id
)
DELETE FROM "RoomAvailabilityRecord" AS duplicate
USING merged
WHERE duplicate."roomTypeId" = merged."roomTypeId"
  AND duplicate.date = merged.date
  AND duplicate.id <> merged.keep_id;

-- CreateIndex
CREATE UNIQUE INDEX "RoomAvailabilityRecord_roomTypeId_date_key" ON "RoomAvailabilityRecord"("roomTypeId", "date");
