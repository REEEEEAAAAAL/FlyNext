-- Index the containment test seat counting runs.
--
-- `flightIds` is a JSON array, and the question asked of it is "which live
-- bookings contain this flight" — a containment test (`@>`) over the whole
-- column, which without an index is a sequential scan per flight. `jsonb_path_ops`
-- is the operator class that supports containment and nothing else, so it is the
-- smallest index that answers this.

-- CreateIndex
CREATE INDEX "AfsOfflineBooking_flightIds_idx"
    ON "AfsOfflineBooking" USING GIN ("flightIds" jsonb_path_ops);
