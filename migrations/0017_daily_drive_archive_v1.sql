-- Isolated receipt only; never alters Original EARLY, signals or analysis bytes.
CREATE TABLE IF NOT EXISTS chass_daily_drive_archives (
 job_id TEXT PRIMARY KEY,
 content_hash TEXT NOT NULL,
 file_id TEXT NOT NULL,
 folder_id TEXT NOT NULL,
 verified_at TEXT
);
