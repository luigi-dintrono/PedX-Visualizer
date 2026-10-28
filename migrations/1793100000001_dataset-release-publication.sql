-- Up Migration
CREATE TABLE IF NOT EXISTS dataset_releases (
    dataset_release_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    manifest JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    activated_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    model_status TEXT NOT NULL DEFAULT 'unavailable_for_release'
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_releases_one_active
    ON dataset_releases(is_active) WHERE is_active;
ALTER TABLE metric_model_runs ADD COLUMN IF NOT EXISTS dataset_release_id TEXT;
ALTER TABLE city_metric_estimates ADD COLUMN IF NOT EXISTS dataset_release_id TEXT;
CREATE INDEX IF NOT EXISTS city_metric_estimates_release ON city_metric_estimates(dataset_release_id);
-- Down Migration
-- Preserve publication/fit provenance during rollback; removing it loses audit data.
