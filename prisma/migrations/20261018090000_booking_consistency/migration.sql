ALTER TABLE "FlightReservation" ADD COLUMN "passengerLastName" TEXT,
ADD COLUMN "cancellationPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Itinerary" ADD COLUMN "paymentMethod" TEXT,
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "confirmationTotal" DOUBLE PRECISION,
ADD COLUMN "cancellationRequested" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "BookingRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "response" JSONB,
  "statusCode" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BookingRequest_userId_key_key" ON "BookingRequest"("userId", "key");
