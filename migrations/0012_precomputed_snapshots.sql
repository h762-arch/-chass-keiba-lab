-- Append-only SOURCE/DATA/MARKET/FINAL/RESULT revisions behind a default-OFF runtime flag.
CREATE TABLE IF NOT EXISTS precomputed_race_snapshots (
  organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')), race_id TEXT NOT NULL, revision INTEGER NOT NULL,
  source_hash TEXT NOT NULL, input_hash TEXT NOT NULL, snapshot_hash TEXT NOT NULL, source_acquired_at TEXT, source_validated_at TEXT NOT NULL, data_calculated_at TEXT, calculated_at TEXT,
  calculation_version TEXT NOT NULL, model_version TEXT NOT NULL, cluster_version TEXT, signal_rule_version TEXT,
  source_json TEXT NOT NULL, data_json TEXT, market_json TEXT, final_json TEXT, result_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('CALCULATED','NOT_CALCULATED','STALE','PARTIAL')) DEFAULT 'PARTIAL',
  created_at TEXT NOT NULL, PRIMARY KEY (organization,race_id,revision)
);
CREATE INDEX IF NOT EXISTS idx_precomputed_input_lookup ON precomputed_race_snapshots(organization,race_id,input_hash,model_version,calculation_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_precomputed_revision_idempotent ON precomputed_race_snapshots(organization,race_id,snapshot_hash);
CREATE INDEX IF NOT EXISTS idx_precomputed_latest ON precomputed_race_snapshots(organization,race_id,revision DESC);
