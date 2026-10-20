ALTER TABLE "bookings" ADD COLUMN "operationKey" TEXT, ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "bookings_agencyId_operationKey_key" ON "bookings"("agencyId", "operationKey");
ALTER TABLE "flights" ADD CONSTRAINT "flights_seats_nonnegative" CHECK ("availableSeats" >= 0) NOT VALID;
ALTER TABLE "flights" VALIDATE CONSTRAINT "flights_seats_nonnegative";
