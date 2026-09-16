-- Append-only SOURCE/DATA/MARKET/FINAL/RESULT revisions behind a default-OFF runtime flag.
CREATE TABLE IF NOT EXISTS precomputed_race_snapshots (
  organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')), race_id TEXT NOT NULL, revision INTEGER NOT NULL,
  source_hash TEXT NOT NULL, input_hash TEXT NOT NULL, source_acquired_at TEXT, calculated_at TEXT NOT NULL,
  calculation_version TEXT NOT NULL, model_version TEXT NOT NULL, cluster_version TEXT, signal_rule_version TEXT,
  source_json TEXT NOT NULL, data_json TEXT, market_json TEXT, final_json TEXT, result_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('NOT_CALCULATED','PARTIAL','READY','STALE')) DEFAULT 'PARTIAL',
  created_at TEXT NOT NULL, PRIMARY KEY (organization,race_id,revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_precomputed_input_idempotent ON precomputed_race_snapshots(organization,race_id,input_hash,model_version,calculation_version);
CREATE INDEX IF NOT EXISTS idx_precomputed_latest ON precomputed_race_snapshots(organization,race_id,revision DESC);
