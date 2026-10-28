-- Up Migration
ALTER TABLE cities ADD COLUMN IF NOT EXISTS external_city_id TEXT;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS admin1_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS cities_external_city_id_unique ON cities(external_city_id);
ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_city_country_key;
CREATE UNIQUE INDEX IF NOT EXISTS cities_legacy_name_unique
    ON cities(city, country, COALESCE(state, '')) WHERE external_city_id IS NULL;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS dataset_release_id TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_run_id TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_video_sha256 TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_source_video_sha256 TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_analysis_run_id TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_origin_run_id TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localized_at TIMESTAMPTZ;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_status TEXT DEFAULT 'legacy_unverified';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS searched_city_id TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS verified_city_id TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS eligibility_status TEXT DEFAULT 'unverified';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS location_verification_source TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS discovery_run_id TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS sampling_strategy TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS search_order TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS analyzed_at_source TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS recording_date_source TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS clip_start_seconds DOUBLE PRECISION;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS clip_end_seconds DOUBLE PRECISION;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS eligible_for_comparison BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS metric_validity JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS dataset_statistics (
    dataset_release_id TEXT NOT NULL, file_name TEXT NOT NULL, row_number INT NOT NULL,
    payload JSONB NOT NULL, PRIMARY KEY(dataset_release_id, file_name, row_number)
);
-- Down Migration
-- Keep identity and release provenance on rollback; removing it would lose audit data.
