-- ============================================================================
-- migrate-add-localization-route.sql
--
-- Idempotent. Adds the camera's estimated ROUTE through the city to `videos`.
--
-- Monocular-OSM-Localization has always produced this: its result.json carries
-- `position.route_latlon` (a polyline of [lat, lon] pairs recovered by visual odometry
-- and snapped to the OSM graph), plus `estimated_length_m` and `trajectory_source`.
-- PedX-Insight's localize.py only ever copied the single chosen POINT into
-- [L1]localization.csv, so the route was computed and then discarded at the CSV
-- boundary. It is now carried through (see that repo's
-- modules/localization/localize.py and scripts/backfill_localization_routes.py).
--
-- These videos are walking tours, so the polyline is the path actually walked — which
-- is why it is worth storing separately from `latitude`/`longitude` (the single point
-- estimate) and from `localization_candidates` (alternative point hypotheses).
-- ============================================================================

SET lock_timeout = '5s';

-- [[lat, lon], ...] in WGS84, ordered along the route. NULL when no route was estimated;
-- that is NOT the same as an empty route, so the importer never writes '[]'.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_route JSONB;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_route_length_m NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS localization_trajectory_source TEXT;

COMMENT ON COLUMN videos.localization_route IS
  'Estimated camera route through the city as [[lat,lon], ...] in WGS84, from Monocular-OSM-Localization result.json position.route_latlon. NULL when no route was estimated.';
COMMENT ON COLUMN videos.localization_route_length_m IS
  'Estimated length of localization_route in metres (result.json estimated_length_m).';
COMMENT ON COLUMN videos.localization_trajectory_source IS
  'How the route was recovered, e.g. ''vo'' for visual odometry (result.json trajectory_source).';

-- Partial: only a small minority of videos are localized at all, and every read of this
-- column filters on IS NOT NULL.
CREATE INDEX IF NOT EXISTS idx_videos_localization_route
    ON videos ((localization_route IS NOT NULL)) WHERE localization_route IS NOT NULL;
