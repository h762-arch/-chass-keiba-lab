-- CHASS favorite-risk prospective snapshot storage.
-- Additive-only migration; existing objects remain untouched.

CREATE TABLE IF NOT EXISTS jra_favorite_risk_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  model_version TEXT,
  organization TEXT NOT NULL,
  race_date TEXT NOT NULL,
  track TEXT,
  race_no INTEGER,
  race_name TEXT,
  stage TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_updated_at TEXT,
  minutes_to_post REAL,
  stage_delta_minutes REAL,
  favorite_horse_no INTEGER,
  favorite_horse_name TEXT,
  favorite_popularity INTEGER,
  favorite_odds REAL,
  second_favorite_odds REAL,
  ai_win_rate REAL,
  ai_place_rate REAL,
  ai_outside3_rate REAL,
  ability_rank INTEGER,
  finish INTEGER,
  top3_flag INTEGER,
  outside3_flag INTEGER,
  final_popularity INTEGER,
  final_odds REAL,
  data_confidence TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  UNIQUE(race_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_jra_favorite_risk_snapshots_day ON jra_favorite_risk_snapshots(race_date, track, race_no);
CREATE INDEX IF NOT EXISTS idx_jra_favorite_risk_snapshots_stage ON jra_favorite_risk_snapshots(stage, captured_at);

CREATE TABLE IF NOT EXISTS nar_favorite_risk_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  model_version TEXT,
  organization TEXT NOT NULL,
  race_date TEXT NOT NULL,
  track TEXT,
  race_no INTEGER,
  race_name TEXT,
  stage TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_updated_at TEXT,
  minutes_to_post REAL,
  stage_delta_minutes REAL,
  favorite_horse_no INTEGER,
  favorite_horse_name TEXT,
  favorite_popularity INTEGER,
  favorite_odds REAL,
  second_favorite_odds REAL,
  ai_win_rate REAL,
  ai_place_rate REAL,
  ai_outside3_rate REAL,
  ability_rank INTEGER,
  finish INTEGER,
  top3_flag INTEGER,
  outside3_flag INTEGER,
  final_popularity INTEGER,
  final_odds REAL,
  data_confidence TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  UNIQUE(race_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_nar_favorite_risk_snapshots_day ON nar_favorite_risk_snapshots(race_date, track, race_no);
CREATE INDEX IF NOT EXISTS idx_nar_favorite_risk_snapshots_stage ON nar_favorite_risk_snapshots(stage, captured_at);
