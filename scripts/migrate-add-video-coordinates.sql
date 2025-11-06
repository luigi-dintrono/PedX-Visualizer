-- Migration: Add latitude and longitude columns to videos table
-- This allows videos to have their own coordinates separate from city coordinates

-- Add latitude and longitude columns to videos table
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);

-- Create index for geographic queries on videos
CREATE INDEX IF NOT EXISTS idx_videos_geographic ON videos(latitude, longitude);

-- Add mock coordinate data to existing videos
-- This generates random coordinates within a small radius around the city center
-- For testing purposes, we'll add coordinates to videos that don't have them
-- Using a subquery to generate random offsets for each video
UPDATE videos v
SET 
  latitude = c.latitude + ((random() - 0.5) * 0.1), -- Random offset within ~5.5km
  longitude = c.longitude + ((random() - 0.5) * 0.1)
FROM cities c
WHERE v.city_id = c.id
  AND (v.latitude IS NULL OR v.longitude IS NULL)
  AND c.latitude IS NOT NULL
  AND c.longitude IS NOT NULL;

-- Update the v_video_summary view to include coordinates
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
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as actual_crosswalk_usage_rate
FROM videos v
LEFT JOIN cities c ON v.city_id = c.id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY v.id, v.video_name, v.link, v.city_link, v.latitude, v.longitude, c.city, c.country, c.continent,
         v.duration_seconds, v.total_frames, v.analysis_seconds, v.total_pedestrians,
         v.total_crossed_pedestrians, v.average_age, v.phone_usage_ratio,
         v.risky_crossing_ratio, v.run_red_light_ratio, v.crosswalk_usage_ratio,
         v.traffic_signs_ratio, v.total_vehicles, v.top3_vehicles, v.main_weather,
         v.sidewalk_prob, v.crosswalk_prob, v.traffic_light_prob, v.avg_road_width,
         v.crossing_time, v.crossing_speed;

