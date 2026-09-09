-- JRA J5: organization-isolated meeting cache. Additive only.
CREATE TABLE IF NOT EXISTS jra_meeting_calendar (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  meetings_json TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT NOT NULL,
  next_refresh_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'JRA_OFFICIAL',
  parser_version TEXT,
  error_code TEXT
);
