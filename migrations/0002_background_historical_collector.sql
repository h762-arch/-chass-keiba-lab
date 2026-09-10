-- Ver.9.9.34: additive-only migration. Existing research rows are untouched.
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
