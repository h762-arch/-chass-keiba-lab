-- Append-only research evidence. Applying this migration to production is a
-- separate operation; the runtime never creates/repairs its audit table.
CREATE TABLE IF NOT EXISTS jra_market_queue_events (
 run_id TEXT NOT NULL,
 event_no INTEGER NOT NULL CHECK(event_no>0),
 race_id TEXT NOT NULL,
 target_date TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 event_json TEXT NOT NULL,
 event_hash TEXT NOT NULL,
 PRIMARY KEY(run_id,event_no)
);
CREATE INDEX IF NOT EXISTS idx_jra_market_queue_date ON jra_market_queue_events(target_date,recorded_at,run_id,event_no);
CREATE INDEX IF NOT EXISTS idx_jra_market_queue_race ON jra_market_queue_events(race_id,recorded_at);
