-- Migration: Add City Insights System
-- Run this to add insights functionality to existing database
-- Usage: psql $DATABASE_URL -f scripts/migrate-add-insights.sql

-- 1. Add insights column to cities table
ALTER TABLE cities ADD COLUMN IF NOT EXISTS insights JSONB DEFAULT '[]'::jsonb;

-- 2. Drop and recreate v_city_summary view with insights
DROP VIEW IF EXISTS v_city_summary CASCADE;

CREATE VIEW v_city_summary AS
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
    -- Aggregated metrics
    COUNT(DISTINCT v.id) as total_videos,
    COUNT(DISTINCT p.id) as total_pedestrians,
    AVG(v.duration_seconds) as avg_video_duration,
    AVG(v.total_pedestrians) as avg_pedestrians_per_video,
    AVG(v.risky_crossing_ratio) as avg_risky_crossing_ratio,
    AVG(v.run_red_light_ratio) as avg_run_red_light_ratio,
    AVG(v.crosswalk_usage_ratio) as avg_crosswalk_usage_ratio,
    AVG(p.age) as avg_pedestrian_age,
    -- Calculated rates
    COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as risky_crossing_rate,
    COUNT(CASE WHEN p.run_red_light THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as run_red_light_rate,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as crosswalk_usage_rate,
    -- Heatmap intensity (composite score)
    COALESCE(
        (AVG(v.risky_crossing_ratio) + AVG(v.run_red_light_ratio)) / 2, 
        COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0)
    ) as risk_intensity
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent, c.latitude, c.longitude, 
         c.population_city, c.traffic_mortality, c.literacy_rate, c.gini, c.insights;

-- 3. Create mv_city_insights materialized view (if not exists)
DROP MATERIALIZED VIEW IF EXISTS mv_city_insights;

CREATE MATERIALIZED VIEW mv_city_insights AS
SELECT 
    c.id as city_id,
    c.city,
    c.country,
    c.continent,
    
    -- Video and pedestrian counts
    COUNT(DISTINCT v.id) as video_count,
    COUNT(DISTINCT p.id) as pedestrian_count,
    
    -- Speed metrics
    AVG(v.crossing_speed) as avg_crossing_speed,
    RANK() OVER (ORDER BY AVG(v.crossing_speed) DESC NULLS LAST) as speed_rank,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.crossing_speed) as median_crossing_speed,
    
    -- Behavioral metrics
    AVG(v.risky_crossing_ratio) as avg_risky_crossing_ratio,
    AVG(v.run_red_light_ratio) as avg_run_red_light_ratio,
    AVG(v.crosswalk_usage_ratio) as avg_crosswalk_usage_ratio,
    RANK() OVER (ORDER BY AVG(v.risky_crossing_ratio) DESC NULLS LAST) as risky_rank,
    RANK() OVER (ORDER BY AVG(v.run_red_light_ratio) DESC NULLS LAST) as red_light_rank,
    
    -- Demographics
    AVG(p.age) as avg_age,
    COUNT(CASE WHEN p.gender = 'male' THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as male_ratio,
    COUNT(CASE WHEN p.phone_using THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as phone_usage_ratio,
    
    -- Weather composition (most common weather)
    MODE() WITHIN GROUP (ORDER BY v.main_weather) as dominant_weather,
    COUNT(DISTINCT v.main_weather) as weather_variety,
    
    -- Top vehicles (aggregate from videos)
    string_agg(DISTINCT v.top3_vehicles, ', ') FILTER (WHERE v.top3_vehicles IS NOT NULL) as vehicles_list,
    
    -- Road width
    AVG(v.avg_road_width) as avg_road_width,
    
    -- Crossing time
    AVG(v.crossing_time) as avg_crossing_time,
    
    -- Continent rank
    RANK() OVER (PARTITION BY c.continent ORDER BY AVG(v.crossing_speed) DESC NULLS LAST) as continent_speed_rank,
    COUNT(DISTINCT c2.id) FILTER (WHERE c2.continent = c.continent) as cities_in_continent
    
FROM cities c
LEFT JOIN cities c2 ON c2.continent = c.continent
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent;

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_city ON mv_city_insights(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_continent ON mv_city_insights(continent);

-- 5. Update refresh function to include mv_city_insights
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_rank_crossing_speed;
    REFRESH MATERIALIZED VIEW mv_global_insights;
    REFRESH MATERIALIZED VIEW mv_city_insights;
    RAISE NOTICE 'Materialized views refreshed successfully';
END;
$$ LANGUAGE plpgsql;

-- Success message
DO $$ 
BEGIN 
    RAISE NOTICE '✅ City Insights migration completed successfully!';
    RAISE NOTICE 'Run: make db-generate-insights to generate insights for all cities';
END $$;

