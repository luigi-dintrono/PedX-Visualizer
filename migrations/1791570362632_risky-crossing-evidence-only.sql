-- Up Migration
--
-- Retire the old risky-crossing construct everywhere, not just in new imports.
--
-- Since 2026-09-07 risky_crossing is EVIDENCE-POSITIVE: a crossing counts only when the
-- signal state was actually observed, and NULL means "undetermined". The fix only reached
-- videos re-analysed after that date (those carry risky_crossing_coverage). The 593 videos
-- imported on 2025-12-18 (pipeline_version NULL) and 4 stale legacy_1hz videos still held
-- values from the OLD rule, which flagged a frame risky when NEITHER detector fired -- the
-- construct shown to track detector recall (rho -0.891), not behaviour. That rule never
-- produced NULL, so all 6,778 of those pedestrians counted as "determined":
--   * 49 of the 60 cities passing the n>=30 risky gate were old-construct only;
--   * mean city rate 0.165 (old) vs 0.302 (evidence-positive) on ONE colour ramp.
--
-- Fix at the source rather than in each of ~15 readers: a risky value without coverage is
-- undetermined. The old values are kept, under an honest name, in *_legacy columns, and
-- BEFORE triggers keep the invariant for every future write (coerce, not reject, so the
-- nightly publish cannot be broken by it -- the coercion is the correct semantics anyway).
--
-- Also fixes the NULL-as-negative denominator (trap #2 of the 2026-09-07 work) in the two
-- places it survived: mv_global_insights' global rates and v_city_summary_at_date().

ALTER TABLE videos ADD COLUMN IF NOT EXISTS risky_crossing_ratio_legacy DECIMAL(5, 4);
ALTER TABLE pedestrians ADD COLUMN IF NOT EXISTS risky_crossing_legacy BOOLEAN;
COMMENT ON COLUMN videos.risky_crossing_ratio_legacy IS
  'Pre-2026-09 risky-crossing construct (frame risky when neither light nor crosswalk detected). Confounded with detector recall; never compare with risky_crossing_ratio.';
COMMENT ON COLUMN pedestrians.risky_crossing_legacy IS
  'Pre-2026-09 risky-crossing flag (old construct). Confounded with detector recall; never pool with risky_crossing.';

UPDATE videos
   SET risky_crossing_ratio_legacy = risky_crossing_ratio,
       risky_crossing_ratio = NULL
 WHERE risky_crossing_coverage IS NULL
   AND risky_crossing_ratio IS NOT NULL;

UPDATE pedestrians p
   SET risky_crossing_legacy = p.risky_crossing,
       risky_crossing = NULL
  FROM videos v
 WHERE v.id = p.video_id
   AND v.risky_crossing_coverage IS NULL
   AND p.risky_crossing IS NOT NULL;

CREATE OR REPLACE FUNCTION videos_risky_needs_coverage() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.risky_crossing_coverage IS NULL AND NEW.risky_crossing_ratio IS NOT NULL THEN
        NEW.risky_crossing_ratio_legacy := NEW.risky_crossing_ratio;
        NEW.risky_crossing_ratio := NULL;
    END IF;
    RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION pedestrians_risky_needs_coverage() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.risky_crossing IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM videos v
         WHERE v.id = NEW.video_id AND v.risky_crossing_coverage IS NOT NULL
    ) THEN
        NEW.risky_crossing_legacy := NEW.risky_crossing;
        NEW.risky_crossing := NULL;
    END IF;
    RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS videos_risky_needs_coverage ON videos;
CREATE TRIGGER videos_risky_needs_coverage
    BEFORE INSERT OR UPDATE OF risky_crossing_ratio, risky_crossing_coverage ON videos
    FOR EACH ROW EXECUTE FUNCTION videos_risky_needs_coverage();

DROP TRIGGER IF EXISTS pedestrians_risky_needs_coverage ON pedestrians;
CREATE TRIGGER pedestrians_risky_needs_coverage
    BEFORE INSERT OR UPDATE OF risky_crossing, video_id ON pedestrians
    FOR EACH ROW EXECUTE FUNCTION pedestrians_risky_needs_coverage();

-- Global baselines: divide each rate by the pedestrians whose flag is known.
-- (Generated from pg_get_viewdef; only the four rate denominators differ.)
DROP MATERIALIZED VIEW mv_global_insights;
CREATE MATERIALIZED VIEW mv_global_insights AS
 SELECT 'global_baselines'::text AS insight_type,
    vid.global_avg_crossing_speed,
    vid.global_avg_risky_crossing_ratio,
    vid.global_avg_run_red_light_ratio,
    vid.global_avg_crosswalk_usage_ratio,
    ped.global_avg_pedestrian_age,
    vid.global_median_crossing_speed,
    vid.global_median_risky_crossing_ratio,
    vid.global_median_run_red_light_ratio,
    vid.global_median_crosswalk_usage_ratio,
    ped.global_median_pedestrian_age,
    vid.global_q1_crossing_speed,
    vid.global_q3_crossing_speed,
    vid.global_q1_risky_crossing_ratio,
    vid.global_q3_risky_crossing_ratio,
    cnt.total_cities,
    vid.total_videos,
    ped.total_pedestrians,
    ped.global_risky_crossing_rate,
    ped.global_run_red_light_rate,
    ped.global_crosswalk_usage_rate,
    ped.global_phone_usage_rate,
    vid.global_localized_videos,
    vid.global_avg_road_width,
    vid.global_avg_pedestrians_per_video,
    vid.global_avg_vehicles_per_video,
    vid.global_avg_traffic_light_prob,
    vid.global_avg_crosswalk_prob,
    vid.global_avg_sidewalk_prob,
    vid.global_avg_accident_prob,
    vid.global_avg_measured_walking_speed,
    vid.global_median_measured_walking_speed,
    vid.global_videos_with_measured_speed
   FROM ( SELECT avg(videos.crossing_speed) AS global_avg_crossing_speed,
            avg(videos.risky_crossing_ratio) AS global_avg_risky_crossing_ratio,
            avg(videos.run_red_light_ratio) AS global_avg_run_red_light_ratio,
            avg(videos.crosswalk_usage_ratio) AS global_avg_crosswalk_usage_ratio,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.crossing_speed::double precision)) AS global_median_crossing_speed,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.risky_crossing_ratio::double precision)) AS global_median_risky_crossing_ratio,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.run_red_light_ratio::double precision)) AS global_median_run_red_light_ratio,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.crosswalk_usage_ratio::double precision)) AS global_median_crosswalk_usage_ratio,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (videos.crossing_speed::double precision)) AS global_q1_crossing_speed,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (videos.crossing_speed::double precision)) AS global_q3_crossing_speed,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (videos.risky_crossing_ratio::double precision)) AS global_q1_risky_crossing_ratio,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (videos.risky_crossing_ratio::double precision)) AS global_q3_risky_crossing_ratio,
            count(*) AS total_videos,
            count(*) FILTER (WHERE videos.localization_status::text = 'ok'::text) AS global_localized_videos,
            avg(videos.avg_road_width) AS global_avg_road_width,
            avg(videos.total_pedestrians) AS global_avg_pedestrians_per_video,
            avg(videos.total_vehicles) AS global_avg_vehicles_per_video,
            avg(videos.traffic_light_prob) AS global_avg_traffic_light_prob,
            avg(videos.crosswalk_prob) AS global_avg_crosswalk_prob,
            avg(videos.sidewalk_prob) AS global_avg_sidewalk_prob,
            avg(videos.accident_prob) AS global_avg_accident_prob,
            avg(videos.measured_walking_speed_mps) AS global_avg_measured_walking_speed,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.measured_walking_speed_mps::double precision)) AS global_median_measured_walking_speed,
            count(videos.measured_walking_speed_mps) AS global_videos_with_measured_speed
           FROM videos) vid
     CROSS JOIN ( SELECT avg(pedestrians.age) AS global_avg_pedestrian_age,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (pedestrians.age::double precision)) AS global_median_pedestrian_age,
            count(*) AS total_pedestrians,
            count(*) FILTER (WHERE pedestrians.risky_crossing)::double precision / NULLIF(count(pedestrians.risky_crossing), 0)::double precision AS global_risky_crossing_rate,
            count(*) FILTER (WHERE pedestrians.run_red_light)::double precision / NULLIF(count(pedestrians.run_red_light), 0)::double precision AS global_run_red_light_rate,
            count(*) FILTER (WHERE pedestrians.crosswalk_use_or_not)::double precision / NULLIF(count(pedestrians.crosswalk_use_or_not), 0)::double precision AS global_crosswalk_usage_rate,
            count(*) FILTER (WHERE pedestrians.phone_using)::double precision / NULLIF(count(pedestrians.phone_using), 0)::double precision AS global_phone_usage_rate
           FROM pedestrians) ped
     CROSS JOIN ( SELECT count(*) AS total_cities
           FROM cities) cnt;

-- Point-in-time variant, same denominator fix. (Generated from pg_get_functiondef.)
CREATE OR REPLACE FUNCTION public.v_city_summary_at_date(target_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(id integer, city character varying, country character varying, continent character varying, latitude numeric, longitude numeric, population_city bigint, traffic_mortality numeric, literacy_rate numeric, gini numeric, insights jsonb, total_videos bigint, total_pedestrians bigint, avg_video_duration numeric, avg_pedestrians_per_video numeric, avg_risky_crossing_ratio numeric, avg_run_red_light_ratio numeric, avg_crosswalk_usage_ratio numeric, avg_pedestrian_age numeric, avg_crossing_speed numeric, avg_crossing_time numeric, avg_phone_usage_ratio numeric, avg_road_width numeric, risky_crossing_rate numeric, run_red_light_rate numeric, crosswalk_usage_rate numeric, phone_usage_rate numeric, risk_intensity numeric, data_as_of_date date)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH vid AS (
        SELECT
            v.city_id,
            COUNT(*)                        AS total_videos,
            AVG(v.duration_seconds)         AS avg_video_duration,
            AVG(v.total_pedestrians)        AS avg_pedestrians_per_video,
            AVG(v.risky_crossing_ratio)     AS avg_risky_crossing_ratio,
            AVG(v.run_red_light_ratio)      AS avg_run_red_light_ratio,
            AVG(v.crosswalk_usage_ratio)    AS avg_crosswalk_usage_ratio,
            AVG(v.crossing_speed)           AS avg_crossing_speed,
            AVG(v.crossing_time)            AS avg_crossing_time,
            AVG(v.phone_usage_ratio)        AS avg_phone_usage_ratio,
            AVG(v.avg_road_width)           AS avg_road_width
        FROM videos v
        WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
          AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        GROUP BY v.city_id
    ),
    ped AS (
        SELECT
            v.city_id,
            COUNT(p.id) AS total_pedestrians,
            AVG(p.age)  AS avg_pedestrian_age,
            COUNT(*) FILTER (WHERE p.risky_crossing)::FLOAT       / NULLIF(COUNT(p.risky_crossing), 0) AS risky_crossing_rate,
            COUNT(*) FILTER (WHERE p.run_red_light)::FLOAT        / NULLIF(COUNT(p.run_red_light), 0) AS run_red_light_rate,
            COUNT(*) FILTER (WHERE p.crosswalk_use_or_not)::FLOAT / NULLIF(COUNT(p.crosswalk_use_or_not), 0) AS crosswalk_usage_rate,
            COUNT(*) FILTER (WHERE p.phone_using)::FLOAT          / NULLIF(COUNT(p.phone_using), 0) AS phone_usage_rate
        FROM pedestrians p
        JOIN videos v ON v.id = p.video_id
        WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
          AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        GROUP BY v.city_id
    )
    SELECT
        c.id,
        c.city,
        c.country,
        c.continent,
        c.latitude,
        c.longitude,
        c.population_city,
        c.traffic_mortality,
        c.literacy_rate,
        c.gini,
        c.insights,
        COALESCE(vid.total_videos, 0),
        COALESCE(ped.total_pedestrians, 0),
        vid.avg_video_duration,
        vid.avg_pedestrians_per_video,
        vid.avg_risky_crossing_ratio,
        vid.avg_run_red_light_ratio,
        vid.avg_crosswalk_usage_ratio,
        ped.avg_pedestrian_age,
        vid.avg_crossing_speed,
        vid.avg_crossing_time,
        vid.avg_phone_usage_ratio,
        vid.avg_road_width,
        ped.risky_crossing_rate::DECIMAL,
        ped.run_red_light_rate::DECIMAL,
        ped.crosswalk_usage_rate::DECIMAL,
        ped.phone_usage_rate::DECIMAL,
        COALESCE(
            (vid.avg_risky_crossing_ratio + vid.avg_run_red_light_ratio) / 2,
            ped.risky_crossing_rate::DECIMAL
        ),
        target_date
    FROM cities c
    LEFT JOIN vid ON vid.city_id = c.id
    LEFT JOIN ped ON ped.city_id = c.id;
END;
$function$;

REFRESH MATERIALIZED VIEW mv_city_summary;
REFRESH MATERIALIZED VIEW mv_city_insights;
REFRESH MATERIALIZED VIEW mv_rank_crossing_speed;

-- Down Migration

DROP TRIGGER IF EXISTS pedestrians_risky_needs_coverage ON pedestrians;
DROP TRIGGER IF EXISTS videos_risky_needs_coverage ON videos;
DROP FUNCTION IF EXISTS pedestrians_risky_needs_coverage();
DROP FUNCTION IF EXISTS videos_risky_needs_coverage();

UPDATE videos SET risky_crossing_ratio = risky_crossing_ratio_legacy
 WHERE risky_crossing_ratio IS NULL AND risky_crossing_ratio_legacy IS NOT NULL;
UPDATE pedestrians SET risky_crossing = risky_crossing_legacy
 WHERE risky_crossing IS NULL AND risky_crossing_legacy IS NOT NULL;
ALTER TABLE pedestrians DROP COLUMN IF EXISTS risky_crossing_legacy;
ALTER TABLE videos DROP COLUMN IF EXISTS risky_crossing_ratio_legacy;

DROP MATERIALIZED VIEW mv_global_insights;
CREATE MATERIALIZED VIEW mv_global_insights AS
 SELECT 'global_baselines'::text AS insight_type,
    vid.global_avg_crossing_speed,
    vid.global_avg_risky_crossing_ratio,
    vid.global_avg_run_red_light_ratio,
    vid.global_avg_crosswalk_usage_ratio,
    ped.global_avg_pedestrian_age,
    vid.global_median_crossing_speed,
    vid.global_median_risky_crossing_ratio,
    vid.global_median_run_red_light_ratio,
    vid.global_median_crosswalk_usage_ratio,
    ped.global_median_pedestrian_age,
    vid.global_q1_crossing_speed,
    vid.global_q3_crossing_speed,
    vid.global_q1_risky_crossing_ratio,
    vid.global_q3_risky_crossing_ratio,
    cnt.total_cities,
    vid.total_videos,
    ped.total_pedestrians,
    ped.global_risky_crossing_rate,
    ped.global_run_red_light_rate,
    ped.global_crosswalk_usage_rate,
    ped.global_phone_usage_rate,
    vid.global_localized_videos,
    vid.global_avg_road_width,
    vid.global_avg_pedestrians_per_video,
    vid.global_avg_vehicles_per_video,
    vid.global_avg_traffic_light_prob,
    vid.global_avg_crosswalk_prob,
    vid.global_avg_sidewalk_prob,
    vid.global_avg_accident_prob,
    vid.global_avg_measured_walking_speed,
    vid.global_median_measured_walking_speed,
    vid.global_videos_with_measured_speed
   FROM ( SELECT avg(videos.crossing_speed) AS global_avg_crossing_speed,
            avg(videos.risky_crossing_ratio) AS global_avg_risky_crossing_ratio,
            avg(videos.run_red_light_ratio) AS global_avg_run_red_light_ratio,
            avg(videos.crosswalk_usage_ratio) AS global_avg_crosswalk_usage_ratio,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.crossing_speed::double precision)) AS global_median_crossing_speed,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.risky_crossing_ratio::double precision)) AS global_median_risky_crossing_ratio,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.run_red_light_ratio::double precision)) AS global_median_run_red_light_ratio,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.crosswalk_usage_ratio::double precision)) AS global_median_crosswalk_usage_ratio,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (videos.crossing_speed::double precision)) AS global_q1_crossing_speed,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (videos.crossing_speed::double precision)) AS global_q3_crossing_speed,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (videos.risky_crossing_ratio::double precision)) AS global_q1_risky_crossing_ratio,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (videos.risky_crossing_ratio::double precision)) AS global_q3_risky_crossing_ratio,
            count(*) AS total_videos,
            count(*) FILTER (WHERE videos.localization_status::text = 'ok'::text) AS global_localized_videos,
            avg(videos.avg_road_width) AS global_avg_road_width,
            avg(videos.total_pedestrians) AS global_avg_pedestrians_per_video,
            avg(videos.total_vehicles) AS global_avg_vehicles_per_video,
            avg(videos.traffic_light_prob) AS global_avg_traffic_light_prob,
            avg(videos.crosswalk_prob) AS global_avg_crosswalk_prob,
            avg(videos.sidewalk_prob) AS global_avg_sidewalk_prob,
            avg(videos.accident_prob) AS global_avg_accident_prob,
            avg(videos.measured_walking_speed_mps) AS global_avg_measured_walking_speed,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.measured_walking_speed_mps::double precision)) AS global_median_measured_walking_speed,
            count(videos.measured_walking_speed_mps) AS global_videos_with_measured_speed
           FROM videos) vid
     CROSS JOIN ( SELECT avg(pedestrians.age) AS global_avg_pedestrian_age,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (pedestrians.age::double precision)) AS global_median_pedestrian_age,
            count(*) AS total_pedestrians,
            count(*) FILTER (WHERE pedestrians.risky_crossing)::double precision / NULLIF(count(*), 0)::double precision AS global_risky_crossing_rate,
            count(*) FILTER (WHERE pedestrians.run_red_light)::double precision / NULLIF(count(*), 0)::double precision AS global_run_red_light_rate,
            count(*) FILTER (WHERE pedestrians.crosswalk_use_or_not)::double precision / NULLIF(count(*), 0)::double precision AS global_crosswalk_usage_rate,
            count(*) FILTER (WHERE pedestrians.phone_using)::double precision / NULLIF(count(*), 0)::double precision AS global_phone_usage_rate
           FROM pedestrians) ped
     CROSS JOIN ( SELECT count(*) AS total_cities
           FROM cities) cnt;

CREATE OR REPLACE FUNCTION public.v_city_summary_at_date(target_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(id integer, city character varying, country character varying, continent character varying, latitude numeric, longitude numeric, population_city bigint, traffic_mortality numeric, literacy_rate numeric, gini numeric, insights jsonb, total_videos bigint, total_pedestrians bigint, avg_video_duration numeric, avg_pedestrians_per_video numeric, avg_risky_crossing_ratio numeric, avg_run_red_light_ratio numeric, avg_crosswalk_usage_ratio numeric, avg_pedestrian_age numeric, avg_crossing_speed numeric, avg_crossing_time numeric, avg_phone_usage_ratio numeric, avg_road_width numeric, risky_crossing_rate numeric, run_red_light_rate numeric, crosswalk_usage_rate numeric, phone_usage_rate numeric, risk_intensity numeric, data_as_of_date date)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH vid AS (
        SELECT
            v.city_id,
            COUNT(*)                        AS total_videos,
            AVG(v.duration_seconds)         AS avg_video_duration,
            AVG(v.total_pedestrians)        AS avg_pedestrians_per_video,
            AVG(v.risky_crossing_ratio)     AS avg_risky_crossing_ratio,
            AVG(v.run_red_light_ratio)      AS avg_run_red_light_ratio,
            AVG(v.crosswalk_usage_ratio)    AS avg_crosswalk_usage_ratio,
            AVG(v.crossing_speed)           AS avg_crossing_speed,
            AVG(v.crossing_time)            AS avg_crossing_time,
            AVG(v.phone_usage_ratio)        AS avg_phone_usage_ratio,
            AVG(v.avg_road_width)           AS avg_road_width
        FROM videos v
        WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
          AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        GROUP BY v.city_id
    ),
    ped AS (
        SELECT
            v.city_id,
            COUNT(p.id) AS total_pedestrians,
            AVG(p.age)  AS avg_pedestrian_age,
            COUNT(*) FILTER (WHERE p.risky_crossing)::FLOAT       / NULLIF(COUNT(p.id), 0) AS risky_crossing_rate,
            COUNT(*) FILTER (WHERE p.run_red_light)::FLOAT        / NULLIF(COUNT(p.id), 0) AS run_red_light_rate,
            COUNT(*) FILTER (WHERE p.crosswalk_use_or_not)::FLOAT / NULLIF(COUNT(p.id), 0) AS crosswalk_usage_rate,
            COUNT(*) FILTER (WHERE p.phone_using)::FLOAT          / NULLIF(COUNT(p.id), 0) AS phone_usage_rate
        FROM pedestrians p
        JOIN videos v ON v.id = p.video_id
        WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
          AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        GROUP BY v.city_id
    )
    SELECT
        c.id,
        c.city,
        c.country,
        c.continent,
        c.latitude,
        c.longitude,
        c.population_city,
        c.traffic_mortality,
        c.literacy_rate,
        c.gini,
        c.insights,
        COALESCE(vid.total_videos, 0),
        COALESCE(ped.total_pedestrians, 0),
        vid.avg_video_duration,
        vid.avg_pedestrians_per_video,
        vid.avg_risky_crossing_ratio,
        vid.avg_run_red_light_ratio,
        vid.avg_crosswalk_usage_ratio,
        ped.avg_pedestrian_age,
        vid.avg_crossing_speed,
        vid.avg_crossing_time,
        vid.avg_phone_usage_ratio,
        vid.avg_road_width,
        ped.risky_crossing_rate::DECIMAL,
        ped.run_red_light_rate::DECIMAL,
        ped.crosswalk_usage_rate::DECIMAL,
        ped.phone_usage_rate::DECIMAL,
        COALESCE(
            (vid.avg_risky_crossing_ratio + vid.avg_run_red_light_ratio) / 2,
            ped.risky_crossing_rate::DECIMAL
        ),
        target_date
    FROM cities c
    LEFT JOIN vid ON vid.city_id = c.id
    LEFT JOIN ped ON ped.city_id = c.id;
END;
$function$;

REFRESH MATERIALIZED VIEW mv_city_summary;
REFRESH MATERIALIZED VIEW mv_city_insights;
REFRESH MATERIALIZED VIEW mv_rank_crossing_speed;
