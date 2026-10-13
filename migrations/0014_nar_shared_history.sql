-- Research observations only; never update or delete frozen observations.
CREATE TABLE IF NOT EXISTS nar_shared_history_observations (
 observation_hash TEXT PRIMARY KEY NOT NULL,
 horse_key TEXT NOT NULL,
 episode_race_id TEXT NOT NULL,
 canonical_date TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 fact_hash TEXT NOT NULL,
 source_race_id TEXT NOT NULL,
 record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nar_shared_history_read
 ON nar_shared_history_observations(horse_key,canonical_date DESC,episode_race_id,observed_at);
CREATE TRIGGER IF NOT EXISTS nar_shared_history_no_update
 BEFORE UPDATE ON nar_shared_history_observations BEGIN
 SELECT RAISE(ABORT,'NAR_SHARED_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS nar_shared_history_no_delete
 BEFORE DELETE ON nar_shared_history_observations BEGIN
 SELECT RAISE(ABORT,'NAR_SHARED_HISTORY_IMMUTABLE'); END;
