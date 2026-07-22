-- ===============================================
-- MIGRATION: materialize v_city_summary as mv_city_summary (hot-path read model)
-- ===============================================
-- v_city_summary aggregates cities × videos × pedestrians on EVERY query. It is the hot
-- path behind /api/data (every globe heatmap paint) and /api/cities (every page load), so
-- each of those requests recomputed the full aggregation over all ~7k pedestrians/620
-- videos on Neon. This snapshot is refreshed together with the other MVs (after imports),
-- which is exactly the data's real change cadence.
--
-- The plain view v_city_summary is KEPT: the MV is defined as a snapshot OF the view, so
-- there is a single source of truth for the aggregation logic, and consumers that need
-- live reads (or that a future migration redefines) keep working. API routes now read
-- mv_city_summary; refresh_materialized_views() refreshes it first (others derive from
-- the same base tables, and the temporal function reads base tables directly).
--
-- REFRESH ... CONCURRENTLY requires a UNIQUE index (idx_mv_city_summary_id) and lets
-- reads continue during refresh; the refresh function falls back to a plain refresh if
-- the concurrent one fails (e.g. first refresh after creation).

DROP MATERIALIZED VIEW IF EXISTS mv_city_summary;
CREATE MATERIALIZED VIEW mv_city_summary AS
SELECT * FROM v_city_summary;

CREATE UNIQUE INDEX idx_mv_city_summary_id ON mv_city_summary(id);
CREATE INDEX idx_mv_city_summary_city ON mv_city_summary(city);
CREATE INDEX idx_mv_city_summary_continent ON mv_city_summary(continent);
-- /api/data filters on coordinates + pedestrian count every request
CREATE INDEX idx_mv_city_summary_coords ON mv_city_summary(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    -- Concurrent refresh keeps /api/data and /api/cities readable during the refresh.
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_city_summary;
    EXCEPTION WHEN OTHERS THEN
        REFRESH MATERIALIZED VIEW mv_city_summary;
    END;
    REFRESH MATERIALIZED VIEW mv_rank_crossing_speed;
    REFRESH MATERIALIZED VIEW mv_global_insights;
    REFRESH MATERIALIZED VIEW mv_city_insights;
    RAISE NOTICE 'Materialized views refreshed successfully';
END;
$function$;

-- Populate on first creation (CREATE ... AS already ran the query; this makes the intent
-- explicit if the migration is re-run after schema changes).
REFRESH MATERIALIZED VIEW mv_city_summary;
