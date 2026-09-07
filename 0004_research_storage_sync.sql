CREATE TABLE IF NOT EXISTS research_sync_queue (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')),
  race_date TEXT NOT NULL,
  track TEXT,
  race_no INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  content_hash TEXT NOT NULL,
  drive_status TEXT NOT NULL DEFAULT 'pending',
  airtable_status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (race_id, model_version)
);

CREATE TABLE IF NOT EXISTS research_archive_manifest (
  archive_key TEXT PRIMARY KEY,
  organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')),
  archive_date TEXT NOT NULL,
  drive_file_id TEXT,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_airtable_manifest (
  research_key TEXT PRIMARY KEY,
  organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')),
  airtable_record_id TEXT,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_sync_due
  ON research_sync_queue(status, next_attempt_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_research_sync_day
  ON research_sync_queue(organization, race_date);
