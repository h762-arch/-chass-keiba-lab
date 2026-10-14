-- Append-only scheduler observability for the bounded NAR precompute trial.
-- Production provisioning remains an explicit migration operation.
CREATE TABLE IF NOT EXISTS nar_precompute_run_audit (
 scheduled_at TEXT PRIMARY KEY,
 run_date TEXT NOT NULL,
 run_status TEXT NOT NULL,
 reason TEXT,
 attempted INTEGER NOT NULL DEFAULT 0 CHECK(attempted>=0),
 saved INTEGER NOT NULL DEFAULT 0 CHECK(saved>=0),
 auto_result_processed INTEGER NOT NULL DEFAULT 0 CHECK(auto_result_processed>=0),
 events_json TEXT NOT NULL DEFAULT '[]',
 recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nar_precompute_run_audit_date ON nar_precompute_run_audit(run_date,scheduled_at);
CREATE TRIGGER IF NOT EXISTS nar_precompute_run_audit_no_update
 BEFORE UPDATE ON nar_precompute_run_audit BEGIN
 SELECT RAISE(ABORT,'NAR_PRECOMPUTE_RUN_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS nar_precompute_run_audit_no_delete
 BEFORE DELETE ON nar_precompute_run_audit BEGIN
 SELECT RAISE(ABORT,'NAR_PRECOMPUTE_RUN_AUDIT_IMMUTABLE'); END;
