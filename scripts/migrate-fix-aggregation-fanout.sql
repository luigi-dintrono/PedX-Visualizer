-- ===============================================
-- MIGRATION: fix pedestrian-join fan-out in aggregates + add crosswalk_usage_rank
-- ===============================================
-- Problem: v_city_summary, mv_global_insights, mv_rank_crossing_speed, mv_city_insights and
-- v_city_summary_at_date all join cities -> videos -> pedestrians and then average VIDEO-level
-- columns (crossing_speed, *_ratio, road_width, ...). The pedestrians LEFT JOIN duplicates each
-- video row once per pedestrian, so those AVG/median/RANK values are silently pedestrian-count
-- weighted instead of per-video. Pedestrian-level columns (age, gender, rates) are the leaf grain
-- and were already correct, so they are kept as-is.
--
-- Fix: aggregate videos and pedestrians in SEPARATE CTEs (each at its own grain), joined on
-- city_id. Also adds crosswalk_usage_rank to mv_city_insights (the /api/metrics/crosswalk_usage
-- route selects it, but it only existed on mv_rank_crossing_speed -> the route 500'd).
--
-- Idempotent and transaction-safe. Column names/order and the function signature are preserved
-- so dependent routes and the get_city_insights / get_top_cities_by_metric / compare functions
-- keep working. Run scripts/refresh-views.js afterwards (this migration also refreshes them).

SET lock_timeout = '5s';

-- ---------------------------------------------------------------
-- v_city_summary (non-materialized; hit by /api/data and /api/cities)
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW v_city_summary AS
WITH vid AS (
    SELECT
        city_id,
        COUNT(*)                              AS total_videos,
        AVG(duration_seconds)                 AS avg_video_duration,
        AVG(total_pedestrians)                AS avg_pedestrians_per_video,
        AVG(risky_crossing_ratio)             AS avg_risky_crossing_ratio,
        AVG(run_red_light_ratio)              AS avg_run_red_light_ratio,
        AVG(crosswalk_usage_ratio)            AS avg_crosswalk_usage_ratio,
        AVG(crossing_speed)                   AS avg_crossing_speed,
        AVG(crossing_time)                    AS avg_crossing_time,
        AVG(phone_usage_ratio)                AS avg_phone_usage_ratio,
        AVG(avg_road_width)                   AS avg_road_width,
        MIN(data_collected_date)              AS earliest_data_date,
        MAX(data_collected_date)              AS latest_data_date,
        MIN(first_imported_at)                AS earliest_import_date,
        MAX(last_updated_at)                  AS latest_update_date,
        COUNT(DISTINCT import_batch_id)       AS import_batch_count
    FROM videos
    GROUP BY city_id
),
ped AS (
    SELECT
        v.city_id,
        COUNT(p.id)                                                                    AS total_pedestrians,
        AVG(p.age)                                                                     AS avg_pedestrian_age,
        COUNT(*) FILTER (WHERE p.risky_crossing)::FLOAT      / NULLIF(COUNT(p.id), 0)  AS risky_crossing_rate,
        COUNT(*) FILTER (WHERE p.run_red_light)::FLOAT       / NULLIF(COUNT(p.id), 0)  AS run_red_light_rate,
        COUNT(*) FILTER (WHERE p.crosswalk_use_or_not)::FLOAT/ NULLIF(COUNT(p.id), 0)  AS crosswalk_usage_rate,
        COUNT(*) FILTER (WHERE p.phone_using)::FLOAT         / NULLIF(COUNT(p.id), 0)  AS phone_usage_rate
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
    COALESCE(vid.total_videos, 0)        AS total_videos,
    COALESCE(ped.total_pedestrians, 0)   AS total_pedestrians,
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
    )                                    AS risk_intensity,
    vid.earliest_data_date,
    vid.latest_data_date,
    vid.earliest_import_date,
    vid.latest_update_date,
    vid.import_batch_count
FROM cities c
LEFT JOIN vid ON vid.city_id = c.id
LEFT JOIN ped ON ped.city_id = c.id;

-- ---------------------------------------------------------------
-- mv_rank_crossing_speed (Top-N rankings)
-- ---------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_rank_crossing_speed;
CREATE MATERIALIZED VIEW mv_rank_crossing_speed AS
WITH vid AS (
    SELECT
        city_id,
        AVG(crossing_speed)        AS avg_crossing_speed,
        AVG(risky_crossing_ratio)  AS avg_risky_crossing_ratio,
        AVG(run_red_light_ratio)   AS avg_run_red_light_ratio,
        AVG(crosswalk_usage_ratio) AS avg_crosswalk_usage_ratio,
        COUNT(*)                   AS video_count
    FROM videos
    GROUP BY city_id
),
ped AS (
    SELECT v.city_id, COUNT(p.id) AS pedestrian_count
    FROM pedestrians p
    JOIN videos v ON v.id = p.video_id
    GROUP BY v.city_id
)
SELECT
    c.id AS city_id,
    c.city,
    c.country,
    c.continent,
    c.latitude,
    c.longitude,
    RANK() OVER (ORDER BY vid.avg_crossing_speed DESC NULLS LAST)        AS crossing_speed_rank,
    RANK() OVER (ORDER BY vid.avg_risky_crossing_ratio DESC NULLS LAST)  AS risky_crossing_rank,
    RANK() OVER (ORDER BY vid.avg_run_red_light_ratio DESC NULLS LAST)   AS run_red_light_rank,
    RANK() OVER (ORDER BY vid.avg_crosswalk_usage_ratio DESC NULLS LAST) AS crosswalk_usage_rank,
    vid.avg_crossing_speed,
    vid.avg_risky_crossing_ratio,
    vid.avg_run_red_light_ratio,
    vid.avg_crosswalk_usage_ratio,
    PERCENT_RANK() OVER (ORDER BY vid.avg_crossing_speed)        AS crossing_speed_percentile,
    PERCENT_RANK() OVER (ORDER BY vid.avg_risky_crossing_ratio)  AS risky_crossing_percentile,
    PERCENT_RANK() OVER (ORDER BY vid.avg_run_red_light_ratio)   AS run_red_light_percentile,
    PERCENT_RANK() OVER (ORDER BY vid.avg_crosswalk_usage_ratio) AS crosswalk_usage_percentile,
    COALESCE(vid.video_count, 0)     AS video_count,
    COALESCE(ped.pedestrian_count, 0) AS pedestrian_count
FROM cities c
LEFT JOIN vid ON vid.city_id = c.id
LEFT JOIN ped ON ped.city_id = c.id;

CREATE INDEX IF NOT EXISTS idx_mv_rank_crossing_speed_city ON mv_rank_crossing_speed(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_rank_crossing_speed_continent ON mv_rank_crossing_speed(continent);

-- ---------------------------------------------------------------
-- mv_global_insights (global baselines) -- video-level and pedestrian-level computed separately
-- ---------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_global_insights;
CREATE MATERIALIZED VIEW mv_global_insights AS
SELECT
    'global_baselines' AS insight_type,
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
    ped.global_phone_usage_rate
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
        COUNT(*) AS total_videos
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
-- mv_city_insights (per-city insights) -- adds crosswalk_usage_rank
-- ---------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_city_insights;
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
        string_agg(DISTINCT top3_vehicles, ', ') FILTER (WHERE top3_vehicles IS NOT NULL) AS vehicles_list
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
        c.id AS city_id,
        c.city,
        c.country,
        c.continent,
        COALESCE(vid.video_count, 0)      AS video_count,
        COALESCE(ped.pedestrian_count, 0) AS pedestrian_count,
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
        vid.avg_crossing_time
    FROM cities c
    LEFT JOIN vid ON vid.city_id = c.id
    LEFT JOIN ped ON ped.city_id = c.id
)
SELECT
    base.city_id,
    base.city,
    base.country,
    base.continent,
    base.video_count,
    base.pedestrian_count,
    base.avg_crossing_speed,
    RANK() OVER (ORDER BY base.avg_crossing_speed DESC NULLS LAST) AS speed_rank,
    base.median_crossing_speed,
    base.avg_risky_crossing_ratio,
    base.avg_run_red_light_ratio,
    base.avg_crosswalk_usage_ratio,
    RANK() OVER (ORDER BY base.avg_risky_crossing_ratio DESC NULLS LAST)  AS risky_rank,
    RANK() OVER (ORDER BY base.avg_run_red_light_ratio DESC NULLS LAST)   AS red_light_rank,
    RANK() OVER (ORDER BY base.avg_crosswalk_usage_ratio DESC NULLS LAST) AS crosswalk_usage_rank,
    base.avg_age,
    base.male_ratio,
    base.phone_usage_ratio,
    base.dominant_weather,
    base.weather_variety,
    base.vehicles_list,
    base.avg_road_width,
    base.avg_crossing_time,
    RANK() OVER (PARTITION BY base.continent ORDER BY base.avg_crossing_speed DESC NULLS LAST) AS continent_speed_rank,
    (SELECT COUNT(*) FROM cities c2 WHERE c2.continent = base.continent) AS cities_in_continent
FROM base;

CREATE INDEX IF NOT EXISTS idx_mv_city_insights_city ON mv_city_insights(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_continent ON mv_city_insights(continent);

-- ---------------------------------------------------------------
-- v_city_summary_at_date(target_date) -- temporal variant, same fan-out fix
-- Signature is unchanged; only the body is corrected.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION v_city_summary_at_date(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    id INTEGER,
    city VARCHAR,
    country VARCHAR,
    continent VARCHAR,
    latitude DECIMAL,
    longitude DECIMAL,
    population_city BIGINT,
    traffic_mortality DECIMAL,
    literacy_rate DECIMAL,
    gini DECIMAL,
    insights JSONB,
    total_videos BIGINT,
    total_pedestrians BIGINT,
    avg_video_duration DECIMAL,
    avg_pedestrians_per_video DECIMAL,
    avg_risky_crossing_ratio DECIMAL,
    avg_run_red_light_ratio DECIMAL,
    avg_crosswalk_usage_ratio DECIMAL,
    avg_pedestrian_age DECIMAL,
    avg_crossing_speed DECIMAL,
    avg_crossing_time DECIMAL,
    avg_phone_usage_ratio DECIMAL,
    avg_road_width DECIMAL,
    risky_crossing_rate DECIMAL,
    run_red_light_rate DECIMAL,
    crosswalk_usage_rate DECIMAL,
    phone_usage_rate DECIMAL,
    risk_intensity DECIMAL,
    data_as_of_date DATE
) AS $$
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
$$ LANGUAGE plpgsql;
