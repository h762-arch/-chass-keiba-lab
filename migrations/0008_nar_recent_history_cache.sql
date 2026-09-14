-- CHASS NAR recent-10 history cache
-- Additive only. No destructive operations.

CREATE TABLE IF NOT EXISTS nar_horse_history_cache (
  lineage_code TEXT PRIMARY KEY,
  horse_name TEXT,
  latest_run_date TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  history_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nar_horse_history_fetched_at
  ON nar_horse_history_cache(fetched_at);

CREATE TABLE IF NOT EXISTS nar_race_history_manifest (
  race_key TEXT NOT NULL,
  horse_no INTEGER NOT NULL,
  lineage_code TEXT NOT NULL,
  horse_name TEXT,
  attached_at TEXT NOT NULL,
  PRIMARY KEY (race_key, horse_no)
);

CREATE INDEX IF NOT EXISTS idx_nar_race_history_lineage
  ON nar_race_history_manifest(lineage_code);
