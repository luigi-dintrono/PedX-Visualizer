-- ===============================================
-- MIGRATION: surface videos.measured_walking_speed_mps in the aggregate views
-- ===============================================
-- measured_walking_speed_mps is the MEASURED per-video median pedestrian walking speed
-- (m/s) produced by PedX-Insight's [S1] dense-tracking speed module. It is distinct from
-- crossing_speed, which is an imported city-level constant joined by city name.
--
-- This migration mirrors every crossing_speed view touchpoint for the measured metric:
--   * v_city_summary        -> avg_measured_walking_speed, measured_speed_video_count
--   * mv_global_insights    -> global_avg_measured_walking_speed,
--                              global_median_measured_walking_speed,
--                              global_videos_with_measured_speed
--   * mv_city_insights      -> avg_measured_walking_speed, median_measured_walking_speed,
--                              measured_speed_video_count, measured_walking_speed_rank
--
-- Sparse-data behaviour (only a handful of videos have values today): AVG / PERCENTILE_CONT
-- ignore NULL inputs, so cities without measured videos get NULL (never 0), and
-- measured_walking_speed_rank is computed ONLY over cities that have at least one measured
-- video (cities without data get NULL rank, not a fake last-place rank).
--
-- Additive only: every existing column is preserved in name, order, and expression
-- (API routes read these views, some via SELECT *). New columns are appended at the end,
-- which is also what CREATE OR REPLACE VIEW requires for v_city_summary.
-- DROP+CREATE is required for the materialized views because their column set cannot be
-- ALTERed in place; their indexes are recreated below.
--
-- Idempotent: safe to run multiple times.
-- Base definitions taken from database/schema.sql (= migrate-extend-insights.sql, the
-- latest prior migration of these views).

SET lock_timeout = '5s';

-- ---------------------------------------------------------------
-- 0. Base column (no-op if scripts/migrate-add-measured-speed.sql already ran)
-- ---------------------------------------------------------------
ALTER TABLE videos ADD COLUMN IF NOT EXISTS measured_walking_speed_mps NUMERIC;
COMMENT ON COLUMN videos.measured_walking_speed_mps IS
  'Median measured walking speed (m/s) of reliable pedestrian tracks from PedX-Insight [S1]; NULL when no dense-tracking analysis exists';

-- ---------------------------------------------------------------
-- 1. v_city_summary (non-materialized; hit by /api/data and /api/cities)
--    Appends: avg_measured_walking_speed, measured_speed_video_count
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW v_city_summary AS
WITH vid AS (
    SELECT
        city_id,
        COUNT(*)                        AS total_videos,
        AVG(duration_seconds)           AS avg_video_duration,
        AVG(total_pedestrians)          AS avg_pedestrians_per_video,
        AVG(risky_crossing_ratio)       AS avg_risky_crossing_ratio,
        AVG(run_red_light_ratio)        AS avg_run_red_light_ratio,
        AVG(crosswalk_usage_ratio)      AS avg_crosswalk_usage_ratio,
        AVG(crossing_speed)             AS avg_crossing_speed,
        AVG(crossing_time)              AS avg_crossing_time,
        AVG(phone_usage_ratio)          AS avg_phone_usage_ratio,
        AVG(avg_road_width)             AS avg_road_width,
        MIN(data_collected_date)        AS earliest_data_date,
        MAX(data_collected_date)        AS latest_data_date,
        MIN(first_imported_at)          AS earliest_import_date,
        MAX(last_updated_at)            AS latest_update_date,
        COUNT(DISTINCT import_batch_id) AS import_batch_count,
        -- MEASURED walking speed (NULL-safe: AVG ignores NULLs; NULL when no measured videos)
        AVG(measured_walking_speed_mps) AS avg_measured_walking_speed,
        COUNT(measured_walking_speed_mps) AS measured_speed_video_count
    FROM videos
    GROUP BY city_id
),
ped AS (
    SELECT
        v.city_id,
        COUNT(p.id)                                                                     AS total_pedestrians,
        AVG(p.age)                                                                      AS avg_pedestrian_age,
        COUNT(*) FILTER (WHERE p.risky_crossing)::FLOAT      / NULLIF(COUNT(p.id), 0)   AS risky_crossing_rate,
        COUNT(*) FILTER (WHERE p.run_red_light)::FLOAT       / NULLIF(COUNT(p.id), 0)   AS run_red_light_rate,
        COUNT(*) FILTER (WHERE p.crosswalk_use_or_not)::FLOAT/ NULLIF(COUNT(p.id), 0)   AS crosswalk_usage_rate,
        COUNT(*) FILTER (WHERE p.phone_using)::FLOAT         / NULLIF(COUNT(p.id), 0)   AS phone_usage_rate
    FROM pedestrians p
    JOIN videos v ON v.id = p.video_id
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
    COALESCE(vid.total_videos, 0)      AS total_videos,
    COALESCE(ped.total_pedestrians, 0) AS total_pedestrians,
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
    ped.risky_crossing_rate,
    ped.run_red_light_rate,
    ped.crosswalk_usage_rate,
    ped.phone_usage_rate,
    COALESCE(
        (vid.avg_risky_crossing_ratio + vid.avg_run_red_light_ratio) / 2,
        ped.risky_crossing_rate
    ) as risk_intensity,
    vid.earliest_data_date,
    vid.latest_data_date,
    vid.earliest_import_date,
    vid.latest_update_date,
    vid.import_batch_count,
    -- NEW (appended; CREATE OR REPLACE VIEW only allows appending)
    vid.avg_measured_walking_speed,
    COALESCE(vid.measured_speed_video_count, 0) AS measured_speed_video_count
FROM cities c
LEFT JOIN vid ON vid.city_id = c.id
LEFT JOIN ped ON ped.city_id = c.id;

-- ---------------------------------------------------------------
-- 2. mv_global_insights (global baselines)
--    Appends: global_avg_measured_walking_speed, global_median_measured_walking_speed,
--             global_videos_with_measured_speed
-- ---------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_global_insights CASCADE;
CREATE MATERIALIZED VIEW mv_global_insights AS
SELECT
    'global_baselines' as insight_type,
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
    -- localization coverage + built-environment baselines (migrate-extend-insights.sql)
    vid.global_localized_videos,
    vid.global_avg_road_width,
    vid.global_avg_pedestrians_per_video,
    vid.global_avg_vehicles_per_video,
    vid.global_avg_traffic_light_prob,
    vid.global_avg_crosswalk_prob,
    vid.global_avg_sidewalk_prob,
    vid.global_avg_accident_prob,
    -- NEW: MEASURED walking speed baselines (NULL when no measured videos exist)
    vid.global_avg_measured_walking_speed,
    vid.global_median_measured_walking_speed,
    vid.global_videos_with_measured_speed
FROM
    (SELECT
        AVG(crossing_speed)        AS global_avg_crossing_speed,
        AVG(risky_crossing_ratio)  AS global_avg_risky_crossing_ratio,
        AVG(run_red_light_ratio)   AS global_avg_run_red_light_ratio,
        AVG(crosswalk_usage_ratio) AS global_avg_crosswalk_usage_ratio,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY crossing_speed)        AS global_median_crossing_speed,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY risky_crossing_ratio)  AS global_median_risky_crossing_ratio,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY run_red_light_ratio)   AS global_median_run_red_light_ratio,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY crosswalk_usage_ratio) AS global_median_crosswalk_usage_ratio,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY crossing_speed)        AS global_q1_crossing_speed,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY crossing_speed)        AS global_q3_crossing_speed,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY risky_crossing_ratio)  AS global_q1_risky_crossing_ratio,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY risky_crossing_ratio)  AS global_q3_risky_crossing_ratio,
        COUNT(*) AS total_videos,
        COUNT(*) FILTER (WHERE localization_status = 'ok') AS global_localized_videos,
        AVG(avg_road_width)        AS global_avg_road_width,
        AVG(total_pedestrians)     AS global_avg_pedestrians_per_video,
        AVG(total_vehicles)        AS global_avg_vehicles_per_video,
        AVG(traffic_light_prob)    AS global_avg_traffic_light_prob,
        AVG(crosswalk_prob)        AS global_avg_crosswalk_prob,
        AVG(sidewalk_prob)         AS global_avg_sidewalk_prob,
        AVG(accident_prob)         AS global_avg_accident_prob,
        -- NEW: AVG/PERCENTILE_CONT ignore NULLs -> computed only over measured videos
        AVG(measured_walking_speed_mps) AS global_avg_measured_walking_speed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY measured_walking_speed_mps) AS global_median_measured_walking_speed,
        COUNT(measured_walking_speed_mps) AS global_videos_with_measured_speed
     FROM videos) vid
CROSS JOIN
    (SELECT
        AVG(age) AS global_avg_pedestrian_age,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY age) AS global_median_pedestrian_age,
        COUNT(*) AS total_pedestrians,
        COUNT(*) FILTER (WHERE risky_crossing)::FLOAT      / NULLIF(COUNT(*), 0) AS global_risky_crossing_rate,
        COUNT(*) FILTER (WHERE run_red_light)::FLOAT       / NULLIF(COUNT(*), 0) AS global_run_red_light_rate,
        COUNT(*) FILTER (WHERE crosswalk_use_or_not)::FLOAT/ NULLIF(COUNT(*), 0) AS global_crosswalk_usage_rate,
        COUNT(*) FILTER (WHERE phone_using)::FLOAT         / NULLIF(COUNT(*), 0) AS global_phone_usage_rate
     FROM pedestrians) ped
CROSS JOIN
    (SELECT COUNT(*) AS total_cities FROM cities) cnt;

-- ---------------------------------------------------------------
-- 3. mv_city_insights (per-city insights + rankings)
--    Appends: avg_measured_walking_speed, median_measured_walking_speed,
--             measured_speed_video_count, measured_walking_speed_rank
-- ---------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_city_insights CASCADE;
CREATE MATERIALIZED VIEW mv_city_insights AS
WITH vid AS (
    SELECT
        city_id,
        COUNT(*)                   AS video_count,
        AVG(crossing_speed)        AS avg_crossing_speed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY crossing_speed) AS median_crossing_speed,
        AVG(risky_crossing_ratio)  AS avg_risky_crossing_ratio,
        AVG(run_red_light_ratio)   AS avg_run_red_light_ratio,
        AVG(crosswalk_usage_ratio) AS avg_crosswalk_usage_ratio,
        AVG(avg_road_width)        AS avg_road_width,
        AVG(crossing_time)         AS avg_crossing_time,
        MODE() WITHIN GROUP (ORDER BY main_weather) AS dominant_weather,
        COUNT(DISTINCT main_weather) AS weather_variety,
        string_agg(DISTINCT top3_vehicles, ', ') FILTER (WHERE top3_vehicles IS NOT NULL) AS vehicles_list,
        -- localization coverage + built-environment + density (migrate-extend-insights.sql)
        COUNT(*) FILTER (WHERE localization_status = 'ok') AS videos_localized,
        (array_agg(street_name) FILTER (WHERE localization_status = 'ok' AND street_name IS NOT NULL))[1] AS localized_street,
        AVG(total_pedestrians)     AS avg_pedestrians_per_video,
        AVG(total_vehicles)        AS avg_vehicles_per_video,
        AVG(traffic_light_prob)    AS avg_traffic_light_prob,
        AVG(crosswalk_prob)        AS avg_crosswalk_prob,
        AVG(sidewalk_prob)         AS avg_sidewalk_prob,
        AVG(accident_prob)         AS avg_accident_prob,
        AVG(crack_prob)            AS avg_crack_prob,
        AVG(potholes_prob)         AS avg_potholes_prob,
        AVG(traffic_signs_ratio)   AS avg_traffic_signs_ratio,
        -- NEW: MEASURED walking speed (NULL for cities without measured videos)
        AVG(measured_walking_speed_mps) AS avg_measured_walking_speed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY measured_walking_speed_mps) AS median_measured_walking_speed,
        COUNT(measured_walking_speed_mps) AS measured_speed_video_count
    FROM videos
    GROUP BY city_id
),
ped AS (
    SELECT
        v.city_id,
        COUNT(p.id) AS pedestrian_count,
        AVG(p.age)  AS avg_age,
        COUNT(*) FILTER (WHERE p.gender = 'male')::FLOAT / NULLIF(COUNT(p.id), 0) AS male_ratio,
        COUNT(*) FILTER (WHERE p.phone_using)::FLOAT     / NULLIF(COUNT(p.id), 0) AS phone_usage_ratio
    FROM pedestrians p
    JOIN videos v ON v.id = p.video_id
    GROUP BY v.city_id
),
base AS (
    SELECT
        c.id as city_id,
        c.city,
        c.country,
        c.continent,
        c.med_age AS city_med_age,
        COALESCE(vid.video_count, 0)      as video_count,
        COALESCE(ped.pedestrian_count, 0) as pedestrian_count,
        vid.avg_crossing_speed,
        vid.median_crossing_speed,
        vid.avg_risky_crossing_ratio,
        vid.avg_run_red_light_ratio,
        vid.avg_crosswalk_usage_ratio,
        ped.avg_age,
        ped.male_ratio,
        ped.phone_usage_ratio,
        vid.dominant_weather,
        vid.weather_variety,
        vid.vehicles_list,
        vid.avg_road_width,
        vid.avg_crossing_time,
        vid.videos_localized,
        vid.localized_street,
        vid.avg_pedestrians_per_video,
        vid.avg_vehicles_per_video,
        vid.avg_traffic_light_prob,
        vid.avg_crosswalk_prob,
        vid.avg_sidewalk_prob,
        vid.avg_accident_prob,
        vid.avg_crack_prob,
        vid.avg_potholes_prob,
        vid.avg_traffic_signs_ratio,
        vid.avg_measured_walking_speed,
        vid.median_measured_walking_speed,
        COALESCE(vid.measured_speed_video_count, 0) AS measured_speed_video_count
    FROM cities c
    LEFT JOIN vid ON vid.city_id = c.id
    LEFT JOIN ped ON ped.city_id = c.id
),
-- Rank ONLY cities that actually have measured data; everyone else keeps NULL rank.
-- (A plain RANK() ... NULLS LAST would hand out fake last-place ranks to the ~99% of
-- cities with no measured videos yet.)
measured_ranked AS (
    SELECT
        city_id,
        RANK() OVER (ORDER BY avg_measured_walking_speed DESC) AS measured_walking_speed_rank
    FROM base
    WHERE avg_measured_walking_speed IS NOT NULL
)
SELECT
    base.city_id,
    base.city,
    base.country,
    base.continent,
    base.city_med_age,
    base.video_count,
    base.pedestrian_count,
    base.avg_crossing_speed,
    RANK() OVER (ORDER BY base.avg_crossing_speed DESC NULLS LAST) as speed_rank,
    base.median_crossing_speed,
    base.avg_risky_crossing_ratio,
    base.avg_run_red_light_ratio,
    base.avg_crosswalk_usage_ratio,
    RANK() OVER (ORDER BY base.avg_risky_crossing_ratio DESC NULLS LAST) as risky_rank,
    RANK() OVER (ORDER BY base.avg_run_red_light_ratio DESC NULLS LAST) as red_light_rank,
    RANK() OVER (ORDER BY base.avg_crosswalk_usage_ratio DESC NULLS LAST) as crosswalk_usage_rank,
    base.avg_age,
    base.male_ratio,
    base.phone_usage_ratio,
    base.dominant_weather,
    base.weather_variety,
    base.vehicles_list,
    base.avg_road_width,
    base.avg_crossing_time,
    base.videos_localized,
    base.localized_street,
    base.avg_pedestrians_per_video,
    base.avg_vehicles_per_video,
    base.avg_traffic_light_prob,
    base.avg_crosswalk_prob,
    base.avg_sidewalk_prob,
    base.avg_accident_prob,
    base.avg_crack_prob,
    base.avg_potholes_prob,
    base.avg_traffic_signs_ratio,
    RANK() OVER (PARTITION BY base.continent ORDER BY base.avg_crossing_speed DESC NULLS LAST) as continent_speed_rank,
    (SELECT COUNT(*) FROM cities c2 WHERE c2.continent = base.continent) as cities_in_continent,
    -- NEW (appended)
    base.avg_measured_walking_speed,
    base.median_measured_walking_speed,
    base.measured_speed_video_count,
    measured_ranked.measured_walking_speed_rank
FROM base
LEFT JOIN measured_ranked ON measured_ranked.city_id = base.city_id;

-- Recreate the indexes dropped with the materialized views
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_city ON mv_city_insights(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_continent ON mv_city_insights(continent);
