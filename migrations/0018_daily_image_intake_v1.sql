CREATE TABLE IF NOT EXISTS chass_daily_image_jobs (
 job_id TEXT PRIMARY KEY, race_date TEXT NOT NULL, status TEXT NOT NULL,
 started_at TEXT NOT NULL, completed_at TEXT, report_json TEXT
);
CREATE TABLE IF NOT EXISTS chass_daily_image_inputs (
 job_id TEXT NOT NULL, race_id TEXT NOT NULL, packet_json TEXT NOT NULL,
 PRIMARY KEY(job_id,race_id)
);
