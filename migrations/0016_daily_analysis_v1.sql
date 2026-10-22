-- Isolated research data only. No change to races, EARLY, signals or existing snapshots.
CREATE TABLE IF NOT EXISTS chass_daily_analysis_jobs (
 job_id TEXT PRIMARY KEY,
 race_date TEXT NOT NULL,
 started_at TEXT NOT NULL,
 completed_at TEXT,
 status TEXT NOT NULL,
 summary_json TEXT
);
CREATE TABLE IF NOT EXISTS chass_daily_analysis_runs (
 job_id TEXT NOT NULL,
 race_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 artifact_json TEXT NOT NULL,
 PRIMARY KEY (job_id,race_id)
);
