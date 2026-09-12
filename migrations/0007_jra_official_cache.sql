CREATE TABLE IF NOT EXISTS jra_official_cache (
  kind TEXT NOT NULL,
  cache_key TEXT PRIMARY KEY,
  organization TEXT NOT NULL DEFAULT 'JRA',
  race_date TEXT NOT NULL,
  track TEXT NOT NULL DEFAULT '',
  race_no INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  source_url TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  parser_version TEXT,
  content_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jra_official_cache_lookup
  ON jra_official_cache(kind, race_date, track, race_no);

CREATE INDEX IF NOT EXISTS idx_jra_official_cache_expiry
  ON jra_official_cache(expires_at);
