-- ===============================================
-- MIGRATION: richer monocular-OSM localization provenance on videos
-- ===============================================
-- The videos table already stores the CHOSEN localization point (latitude/longitude),
-- localization_confidence, street_name and localization_status. This migration adds the two
-- remaining fields from summary_data/all_video_locations.csv so the app can show WHAT the
-- localization chose and how uncertain it is:
--   * localization_spread_m   — confidence_spread_m: the uncertainty radius in metres.
--   * localization_candidates — the ranked candidate locations JSON:
--         [{ "rank", "latitude", "longitude", "street_names":[...], "support", "google_maps_url" }]
--     (rank 1 == the chosen point already mirrored into latitude/longitude).
--
-- Idempotent. Populated by scripts/import-video-coordinates.js; exposed by
-- /api/cities/[city]/videos; rendered on the globe (confidence circle + candidate markers).

ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_spread_m NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_candidates JSONB;

COMMENT ON COLUMN videos.localization_spread_m IS
  'Monocular-OSM localization uncertainty radius in metres (all_video_locations.csv confidence_spread_m).';
COMMENT ON COLUMN videos.localization_candidates IS
  'Ranked candidate locations JSON [{rank,latitude,longitude,street_names[],support,google_maps_url}] (all_video_locations.csv candidates); rank 1 is the chosen point in latitude/longitude.';
