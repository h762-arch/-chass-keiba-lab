-- Additive Phase 3 metadata for lightweight manifest reads.
-- Existing race_id and snapshot JSON remain unchanged.
ALTER TABLE races ADD COLUMN race_fp TEXT;
ALTER TABLE races ADD COLUMN prediction_fp TEXT;
ALTER TABLE races ADD COLUMN market_fp TEXT;
ALTER TABLE races ADD COLUMN final_fp TEXT;
ALTER TABLE races ADD COLUMN result_fp TEXT;
ALTER TABLE races ADD COLUMN validation_fp TEXT;
ALTER TABLE races ADD COLUMN live_fp TEXT;
