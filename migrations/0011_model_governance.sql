-- CHASS Model Governance v1. Additive only; no production promotion is performed by this migration.
CREATE TABLE IF NOT EXISTS model_change_candidates (
  change_id TEXT PRIMARY KEY, organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')),
  theme TEXT NOT NULL CHECK (theme IN ('calibration','win_score','place_score','time','conditional_adjustment','ability_core','signal_threshold')),
  baseline_version TEXT NOT NULL, shadow_version TEXT NOT NULL, production_version TEXT, rollback_version TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('discovery','shadow','approved','production','monitoring','rolled_back')) DEFAULT 'discovery',
  discovery_race_count INTEGER NOT NULL DEFAULT 0 CHECK (discovery_race_count >= 0), shadow_race_count INTEGER NOT NULL DEFAULT 0 CHECK (shadow_race_count >= 0), monitoring_race_count INTEGER NOT NULL DEFAULT 0 CHECK (monitoring_race_count >= 0),
  baseline_kpi_json TEXT, shadow_kpi_json TEXT, promotion_review_json TEXT,
  adopted INTEGER NOT NULL DEFAULT 0 CHECK (adopted IN (0,1)), baseline_preserved INTEGER NOT NULL DEFAULT 1 CHECK (baseline_preserved IN (0,1)), explicit_approval INTEGER NOT NULL DEFAULT 0 CHECK (explicit_approval IN (0,1)),
  note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, adopted_at TEXT, rolled_back_at TEXT, rollback_reason TEXT,
  CHECK (baseline_version <> shadow_version)
);
CREATE INDEX IF NOT EXISTS idx_model_change_org_stage ON model_change_candidates(organization,stage,updated_at);
CREATE INDEX IF NOT EXISTS idx_model_change_org_theme ON model_change_candidates(organization,theme,updated_at);
CREATE TABLE IF NOT EXISTS model_change_events (
  event_id TEXT PRIMARY KEY, change_id TEXT NOT NULL, organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')), theme TEXT NOT NULL,
  from_stage TEXT NOT NULL, to_stage TEXT NOT NULL, baseline_version TEXT NOT NULL, shadow_version TEXT NOT NULL, production_version TEXT, event_json TEXT, occurred_at TEXT NOT NULL,
  FOREIGN KEY (change_id) REFERENCES model_change_candidates(change_id)
);
CREATE INDEX IF NOT EXISTS idx_model_change_events_change ON model_change_events(change_id,occurred_at);
CREATE TABLE IF NOT EXISTS model_shadow_predictions (
  organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')), race_id TEXT NOT NULL, horse_no INTEGER NOT NULL, theme TEXT NOT NULL,
  baseline_version TEXT NOT NULL, shadow_version TEXT NOT NULL, input_hash TEXT, baseline_snapshot_json TEXT NOT NULL, shadow_snapshot_json TEXT NOT NULL, result_snapshot_json TEXT,
  created_at TEXT NOT NULL, result_attached_at TEXT, PRIMARY KEY (organization,race_id,horse_no,shadow_version,theme)
);
CREATE INDEX IF NOT EXISTS idx_model_shadow_org_version ON model_shadow_predictions(organization,shadow_version,theme,race_id);
CREATE TABLE IF NOT EXISTS model_registry (
  organization TEXT NOT NULL CHECK (organization IN ('JRA','NAR')), theme TEXT NOT NULL, production_version TEXT NOT NULL, previous_version TEXT, active_change_id TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (organization,theme)
);
