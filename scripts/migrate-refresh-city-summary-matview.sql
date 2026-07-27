-- ===============================================
-- MIGRATION: make mv_city_summary track v_city_summary's full column set
-- ===============================================
-- /api/data (the Globe's data source) reads mv_city_summary, which was defined with an
-- explicit, frozen column list. A materialized view does NOT gain columns on REFRESH, so
-- every metric added to v_city_summary was invisible to the API -- the new insight metrics
-- (measured crossing speed, look-before-crossing, PET conflicts, hesitation, vehicle speed,
-- social groups) failed with "column does not exist".
--
-- Redefining it as SELECT * FROM v_city_summary means future view columns flow through
-- automatically instead of needing a matching matview migration each time.
--
-- Indexes are recreated exactly as they were (the unique index on id is required for
-- REFRESH MATERIALIZED VIEW CONCURRENTLY).
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

DROP MATERIALIZED VIEW IF EXISTS mv_city_summary CASCADE;

CREATE MATERIALIZED VIEW mv_city_summary AS
SELECT * FROM v_city_summary;

CREATE UNIQUE INDEX idx_mv_city_summary_id ON public.mv_city_summary USING btree (id);
CREATE INDEX idx_mv_city_summary_city ON public.mv_city_summary USING btree (city);
CREATE INDEX idx_mv_city_summary_continent ON public.mv_city_summary USING btree (continent);
CREATE INDEX idx_mv_city_summary_coords ON public.mv_city_summary USING btree (latitude, longitude)
  WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));
