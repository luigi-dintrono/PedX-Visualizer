-- Migration: extend the insight materialized views with signals the pipeline already
-- produces but the insight generator never surfaced — localization coverage, built-
-- environment/infrastructure, road hazards, pedestrian/vehicle density — plus city
-- median age for an observed-vs-resident age insight.
--
-- Additive only: every existing column is preserved (API routes read these views, some
-- via SELECT *), so new columns cannot break current consumers. DROP+CREATE is required
-- because a materialized view's column set cannot be ALTERed in place.

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
    -- NEW: localization coverage + built-environment baselines
    vid.global_localized_videos,
    vid.global_avg_road_width,
    vid.global_avg_pedestrians_per_video,
    vid.global_avg_vehicles_per_video,
    vid.global_avg_traffic_light_prob,
    vid.global_avg_crosswalk_prob,
    vid.global_avg_sidewalk_prob,
    vid.global_avg_accident_prob
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
        AVG(accident_prob)         AS global_avg_accident_prob
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
        -- NEW: localization coverage + built-environment + density
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
        AVG(traffic_signs_ratio)   AS avg_traffic_signs_ratio
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
        vid.avg_traffic_signs_ratio
    FROM cities c
    LEFT JOIN vid ON vid.city_id = c.id
    LEFT JOIN ped ON ped.city_id = c.id
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
    -- NEW columns
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
    (SELECT COUNT(*) FROM cities c2 WHERE c2.continent = base.continent) as cities_in_continent
FROM base;

CREATE INDEX IF NOT EXISTS idx_mv_city_insights_city ON mv_city_insights(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_continent ON mv_city_insights(continent);
