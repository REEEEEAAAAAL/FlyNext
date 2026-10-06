-- Durable state for the in-process AFS provider (see the model comment in
-- schema.prisma).
--
-- Additive only: no existing table, column or row is touched. The
-- "BookingStatus" enum already exists from the init migration.
--
-- The unique key is the provider's booking id — the passenger-facing reference's
-- source, and the value `GET /api/bookings/retrieve` and `POST /api/bookings/cancel`
-- authorise with — so a write is idempotent and a lookup needs no scan.

-- CreateTable
CREATE TABLE "AfsOfflineBooking" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passportNumber" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "flightIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AfsOfflineBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AfsOfflineBooking_status_idx" ON "AfsOfflineBooking"("status");
