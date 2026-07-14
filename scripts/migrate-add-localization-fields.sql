-- Migration: Add localization metadata columns to videos table
-- These columns store the provenance of real video coordinates produced by the
-- PedX-Insight localization pipeline (summary_data/all_video_locations.csv),
-- imported via scripts/import-video-coordinates.js

-- Add localization metadata columns to videos table
ALTER TABLE videos
ADD COLUMN IF NOT EXISTS localization_confidence VARCHAR(16),
ADD COLUMN IF NOT EXISTS street_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS localization_status VARCHAR(32);

-- Update the v_video_summary view to include the localization columns.
-- The new columns are appended at the END of the select list because
-- CREATE OR REPLACE VIEW only allows adding columns after the existing ones.
CREATE OR REPLACE VIEW v_video_summary AS
SELECT
    v.id,
    v.video_name,
    v.link,
    v.city_link,
    v.latitude,
    v.longitude,
    c.city,
    c.country,
    c.continent,
    v.duration_seconds,
    v.total_frames,
    v.analysis_seconds,
    v.total_pedestrians,
    v.total_crossed_pedestrians,
    v.average_age,
    v.phone_usage_ratio,
    v.risky_crossing_ratio,
    v.run_red_light_ratio,
    v.crosswalk_usage_ratio,
    v.traffic_signs_ratio,
    v.total_vehicles,
    v.top3_vehicles,
    v.main_weather,
    v.sidewalk_prob,
    v.crosswalk_prob,
    v.traffic_light_prob,
    v.avg_road_width,
    v.crossing_time,
    v.crossing_speed,
    -- Pedestrian statistics
    COUNT(p.id) as pedestrian_count,
    AVG(p.age) as avg_age,
    COUNT(CASE WHEN p.gender = 'male' THEN 1 END) as male_count,
    COUNT(CASE WHEN p.gender = 'female' THEN 1 END) as female_count,
    COUNT(CASE WHEN p.risky_crossing THEN 1 END) as risky_crossing_count,
    COUNT(CASE WHEN p.run_red_light THEN 1 END) as run_red_light_count,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END) as crosswalk_usage_count,
    -- Calculated rates
    COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as actual_risky_crossing_rate,
    COUNT(CASE WHEN p.run_red_light THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as actual_run_red_light_rate,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as actual_crosswalk_usage_rate,
    -- Localization metadata (from PedX-Insight)
    v.localization_confidence,
    v.street_name,
    v.localization_status
FROM videos v
LEFT JOIN cities c ON v.city_id = c.id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY v.id, v.video_name, v.link, v.city_link, v.latitude, v.longitude, c.city, c.country, c.continent,
         v.duration_seconds, v.total_frames, v.analysis_seconds, v.total_pedestrians,
         v.total_crossed_pedestrians, v.average_age, v.phone_usage_ratio,
         v.risky_crossing_ratio, v.run_red_light_ratio, v.crosswalk_usage_ratio,
         v.traffic_signs_ratio, v.total_vehicles, v.top3_vehicles, v.main_weather,
         v.sidewalk_prob, v.crosswalk_prob, v.traffic_light_prob, v.avg_road_width,
         v.crossing_time, v.crossing_speed, v.localization_confidence, v.street_name,
         v.localization_status;
