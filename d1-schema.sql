CREATE TABLE IF NOT EXISTS races (
  race_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  race_json TEXT NOT NULL,
  prediction_json TEXT NOT NULL,
  market_json TEXT,
  final_json TEXT,
  result_json TEXT,
  validation_json TEXT,
  prediction_created_at TEXT,
  result_acquired_at TEXT,
  status TEXT NOT NULL DEFAULT 'prediction_saved',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (race_id, model_version)
);

CREATE TABLE IF NOT EXISTS predictions (
  race_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  horse_no INTEGER NOT NULL,
  horse_name TEXT,
  mark TEXT,
  ai_win_rate REAL,
  ai_place_rate REAL,
  overall REAL,
  predicted_time TEXT,
  predicted_time_type TEXT,
  popularity INTEGER,
  odds REAL,
  expected_value REAL,
  longshot_score REAL,
  value_type TEXT,
  market_gap_score REAL,
  snapshot_json TEXT NOT NULL,
  prediction_created_at TEXT,
  PRIMARY KEY (race_id, model_version, horse_no)
);

CREATE TABLE IF NOT EXISTS results (
  race_id TEXT NOT NULL,
  horse_no INTEGER NOT NULL,
  finish INTEGER,
  actual_time TEXT,
  final_3f REAL,
  passing_order TEXT,
  result_acquired_at TEXT,
  result_json TEXT NOT NULL,
  PRIMARY KEY (race_id, horse_no)
);

CREATE INDEX IF NOT EXISTS idx_races_updated_at ON races(updated_at);
CREATE INDEX IF NOT EXISTS idx_results_race_id ON results(race_id);

CREATE TABLE IF NOT EXISTS meeting_calendar (
  date TEXT NOT NULL,
  track TEXT NOT NULL,
  status TEXT NOT NULL,
  race_numbers_json TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'NAR RaceList',
  PRIMARY KEY (date, track)
);

CREATE TABLE IF NOT EXISTS historical_collector_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  period_days INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  tracks_json TEXT NOT NULL,
  phase TEXT NOT NULL,
  current_date TEXT,
  current_track TEXT,
  current_race INTEGER,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  paused_at TEXT,
  last_run_at TEXT,
  next_run_at TEXT,
  locked_until TEXT,
  last_error TEXT,
  background_runs INTEGER NOT NULL DEFAULT 0,
  last_batch_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_historical_jobs_status
  ON historical_collector_jobs(status, updated_at);
