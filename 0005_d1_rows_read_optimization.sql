-- PHASE A only: prepare this additive index without applying it remotely
-- before the daily D1 quota reset and usage verification.
--
-- Supports the five-minute Auto Result query:
--   WHERE status IN (...) ORDER BY updated_at ASC LIMIT 50
--
-- Safe and additive: no table rebuild, delete, or data rewrite.
CREATE INDEX IF NOT EXISTS idx_races_status_updated_at
  ON races(status, updated_at);
