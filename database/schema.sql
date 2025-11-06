-- ===============================================
-- PEDX VISUALIZER DATABASE SCHEMA
-- New comprehensive schema for CSV data aggregation
-- ===============================================

-- Drop existing tables and views to start fresh
DROP VIEW IF EXISTS MetricInsight CASCADE;
DROP VIEW IF EXISTS MetricInsight_CrossingDistance CASCADE;
DROP VIEW IF EXISTS MetricInsight_WaitingTime CASCADE;
DROP VIEW IF EXISTS MetricInsight_TimeToStart CASCADE;
DROP VIEW IF EXISTS MetricInsight_CrossingSpeed CASCADE;
DROP VIEW IF EXISTS CityInsight CASCADE;
DROP TABLE IF EXISTS CoreGlobalCrossingData CASCADE;

-- ===============================================
-- CORE TABLES
-- ===============================================

-- Cities table - geographic and demographic data
CREATE TABLE cities (
    id SERIAL PRIMARY KEY,
    city VARCHAR(255) NOT NULL,
    state VARCHAR(255),
    country VARCHAR(255) NOT NULL,
    iso3 VARCHAR(3),
    continent VARCHAR(255),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    -- Demographics
    gmp DECIMAL(15, 2), -- Gross Metropolitan Product
    population_city BIGINT,
    population_country BIGINT,
    traffic_mortality DECIMAL(5, 2),
    literacy_rate DECIMAL(5, 2),
    avg_height DECIMAL(5, 2),
    med_age DECIMAL(5, 2),
    gini DECIMAL(5, 2),
    -- Insights
    insights JSONB DEFAULT '[]'::jsonb,
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(city, country) -- Prevent duplicate cities
);

-- Videos table - video analysis data
CREATE TABLE videos (
    id SERIAL PRIMARY KEY,
    city_id INTEGER REFERENCES cities(id) ON DELETE CASCADE,
    link VARCHAR(255) NOT NULL UNIQUE,
    video_name VARCHAR(255) NOT NULL,
    city_link VARCHAR(255), -- city_link from CSV
    -- Video metrics
    duration_seconds DECIMAL(10, 4),
    total_frames INTEGER,
    analysis_seconds DECIMAL(10, 4), -- from all_time_info.csv
    -- Pedestrian counts and ratios
    total_pedestrians INTEGER,
    total_crossed_pedestrians INTEGER,
    average_age DECIMAL(5, 2),
    phone_usage_ratio DECIMAL(5, 4),
    risky_crossing_ratio DECIMAL(5, 4),
    run_red_light_ratio DECIMAL(5, 4),
    crosswalk_usage_ratio DECIMAL(5, 4),
    traffic_signs_ratio DECIMAL(5, 4),
    -- Vehicle data
    total_vehicles INTEGER,
    top3_vehicles TEXT, -- JSON-like string
    -- Environmental conditions
    main_weather VARCHAR(50),
    -- Infrastructure probabilities
    sidewalk_prob DECIMAL(5, 4),
    crosswalk_prob DECIMAL(5, 4),
    traffic_light_prob DECIMAL(5, 4),
    avg_road_width DECIMAL(8, 4),
    -- Road conditions
    crack_prob DECIMAL(5, 4),
    potholes_prob DECIMAL(5, 4),
    police_car_prob DECIMAL(5, 4),
    arrow_board_prob DECIMAL(5, 4),
    cones_prob DECIMAL(5, 4),
    accident_prob DECIMAL(5, 4),
    -- Crossing metrics
    crossing_time DECIMAL(8, 4),
    crossing_speed DECIMAL(8, 4),
    -- Geographic coordinates (optional - if null, use city coordinates)
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pedestrians table - individual pedestrian data
CREATE TABLE pedestrians (
    id SERIAL PRIMARY KEY,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL,
    -- Basic info
    crossed BOOLEAN,
    nearby_count_beginning INTEGER,
    nearby_count_whole INTEGER,
    -- Behavior
    risky_crossing BOOLEAN,
    run_red_light BOOLEAN,
    crosswalk_use_or_not BOOLEAN,
    -- Demographics
    gender VARCHAR(20),
    age INTEGER,
    phone_using BOOLEAN,
    -- Carried items
    backpack BOOLEAN,
    umbrella BOOLEAN,
    handbag BOOLEAN,
    suitcase BOOLEAN,
    -- Clothing - shirts
    short_sleeved_shirt BOOLEAN,
    long_sleeved_shirt BOOLEAN,
    short_sleeved_outwear BOOLEAN,
    long_sleeved_outwear BOOLEAN,
    vest BOOLEAN,
    sling BOOLEAN,
    -- Clothing - bottoms
    shorts BOOLEAN,
    trousers BOOLEAN,
    skirt BOOLEAN,
    -- Clothing - dresses
    short_sleeved_dress BOOLEAN,
    long_sleeved_dress BOOLEAN,
    vest_dress BOOLEAN,
    sling_dress BOOLEAN,
    -- Environmental conditions
    weather VARCHAR(50),
    daytime BOOLEAN,
    -- Infrastructure presence
    police_car BOOLEAN,
    arrow_board BOOLEAN,
    cones BOOLEAN,
    accident BOOLEAN,
    crack BOOLEAN,
    potholes BOOLEAN,
    -- Vehicle counts (individual pedestrian context)
    avg_vehicle_total INTEGER,
    crossing_sign BOOLEAN,
    avg_road_width DECIMAL(8, 4),
    crosswalk BOOLEAN,
    sidewalk BOOLEAN,
    -- Vehicle types (boolean flags for each type)
    ambulance BOOLEAN,
    army_vehicle BOOLEAN,
    auto_rickshaw BOOLEAN,
    bicycle BOOLEAN,
    bus BOOLEAN,
    car BOOLEAN,
    garbagevan BOOLEAN,
    human BOOLEAN,
    hauler BOOLEAN,
    minibus BOOLEAN,
    minivan BOOLEAN,
    motorbike BOOLEAN,
    pickup BOOLEAN,
    policecar BOOLEAN,
    rickshaw BOOLEAN,
    scooter BOOLEAN,
    suv BOOLEAN,
    taxi BOOLEAN,
    three_wheelers_cng BOOLEAN,
    truck BOOLEAN,
    van BOOLEAN,
    wheelbarrow BOOLEAN,
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(video_id, track_id) -- Prevent duplicate pedestrians per video
);

-- ===============================================
-- ANALYTICS TABLES
-- ===============================================

-- Analytics dimensions - categorical data for grouping
CREATE TABLE analytics_dimensions (
    id SERIAL PRIMARY KEY,
    dimension_type VARCHAR(100) NOT NULL, -- 'age', 'gender', 'weather', 'clothing', etc.
    dimension_value VARCHAR(255) NOT NULL, -- specific value like 'male', '25-30', 'rain'
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dimension_type, dimension_value)
);

-- Analytics facts - numerical measurements and correlations
CREATE TABLE analytics_facts (
    id SERIAL PRIMARY KEY,
    fact_type VARCHAR(100) NOT NULL, -- 'statistic', 'correlation', 'ratio', etc.
    metric_name VARCHAR(255) NOT NULL, -- 'risky_crossing_rate', 'run_red_light_rate', etc.
    dimension_id INTEGER REFERENCES analytics_dimensions(id) ON DELETE SET NULL,
    -- Numerical values
    value_numeric DECIMAL(15, 6),
    value_percentage DECIMAL(8, 4),
    correlation_coefficient DECIMAL(8, 6),
    -- Additional context
    sample_size INTEGER,
    confidence_level DECIMAL(5, 4),
    -- Metadata
    data_source VARCHAR(255), -- which CSV this came from
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===============================================
-- INDEXES FOR PERFORMANCE
-- ===============================================

-- Cities indexes
CREATE INDEX idx_cities_city ON cities(city);
CREATE INDEX idx_cities_country ON cities(country);
CREATE INDEX idx_cities_continent ON cities(continent);
CREATE INDEX idx_cities_geographic ON cities(latitude, longitude);

-- Videos indexes
CREATE INDEX idx_videos_city_id ON videos(city_id);
CREATE INDEX idx_videos_link ON videos(link);
CREATE INDEX idx_videos_weather ON videos(main_weather);
CREATE INDEX idx_videos_geographic ON videos(latitude, longitude);

-- Pedestrians indexes
CREATE INDEX idx_pedestrians_video_id ON pedestrians(video_id);
CREATE INDEX idx_pedestrians_track_id ON pedestrians(track_id);
CREATE INDEX idx_pedestrians_gender ON pedestrians(gender);
CREATE INDEX idx_pedestrians_age ON pedestrians(age);
CREATE INDEX idx_pedestrians_behavior ON pedestrians(risky_crossing, run_red_light, crosswalk_use_or_not);

-- Analytics indexes
CREATE INDEX idx_analytics_dimensions_type ON analytics_dimensions(dimension_type);
CREATE INDEX idx_analytics_facts_type ON analytics_facts(fact_type);
CREATE INDEX idx_analytics_facts_metric ON analytics_facts(metric_name);
CREATE INDEX idx_analytics_facts_dimension ON analytics_facts(dimension_id);

-- ===============================================
-- HELPER VIEWS FOR FRONTEND CONSUMPTION
-- ===============================================

-- City summary view with aggregated data
CREATE OR REPLACE VIEW city_summary AS
SELECT 
    c.id,
    c.city,
    c.country,
    c.continent,
    c.latitude,
    c.longitude,
    c.population_city,
    c.traffic_mortality,
    COUNT(DISTINCT v.id) as total_videos,
    COUNT(DISTINCT p.id) as total_pedestrians,
    AVG(v.duration_seconds) as avg_video_duration,
    AVG(v.total_pedestrians) as avg_pedestrians_per_video,
    AVG(v.risky_crossing_ratio) as avg_risky_crossing_ratio,
    AVG(v.run_red_light_ratio) as avg_run_red_light_ratio,
    AVG(v.crosswalk_usage_ratio) as avg_crosswalk_usage_ratio,
    AVG(p.age) as avg_pedestrian_age,
    COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / COUNT(*) as risky_crossing_rate,
    COUNT(CASE WHEN p.run_red_light THEN 1 END)::FLOAT / COUNT(*) as run_red_light_rate
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent, c.latitude, c.longitude, c.population_city, c.traffic_mortality;

-- Video summary view
CREATE OR REPLACE VIEW video_summary AS
SELECT 
    v.id,
    v.video_name,
    v.link,
    c.city,
    c.country,
    v.duration_seconds,
    v.total_pedestrians,
    v.total_crossed_pedestrians,
    v.main_weather,
    v.risky_crossing_ratio,
    v.run_red_light_ratio,
    v.crosswalk_usage_ratio,
    COUNT(p.id) as pedestrian_count,
    AVG(p.age) as avg_age,
    COUNT(CASE WHEN p.gender = 'male' THEN 1 END) as male_count,
    COUNT(CASE WHEN p.gender = 'female' THEN 1 END) as female_count
FROM videos v
LEFT JOIN cities c ON v.city_id = c.id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY v.id, v.video_name, v.link, c.city, c.country, v.duration_seconds, 
         v.total_pedestrians, v.total_crossed_pedestrians, v.main_weather,
         v.risky_crossing_ratio, v.run_red_light_ratio, v.crosswalk_usage_ratio;

-- Analytics summary view
CREATE OR REPLACE VIEW analytics_summary AS
SELECT 
    af.id,
    af.fact_type,
    af.metric_name,
    ad.dimension_type,
    ad.dimension_value,
    af.value_numeric,
    af.value_percentage,
    af.correlation_coefficient,
    af.sample_size,
    af.data_source
FROM analytics_facts af
LEFT JOIN analytics_dimensions ad ON af.dimension_id = ad.id
ORDER BY af.metric_name, ad.dimension_type;

-- ===============================================
-- FRONTEND CONSUMPTION VIEWS
-- ===============================================

-- v_city_summary: Powers Cesium map (heatmap, markers)
CREATE OR REPLACE VIEW v_city_summary AS
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
    -- Additional behavior metrics for heatmap
    AVG(v.crossing_speed) as avg_crossing_speed,
    AVG(v.crossing_time) as avg_crossing_time,
    AVG(v.phone_usage_ratio) as avg_phone_usage_ratio,
    AVG(v.avg_road_width) as avg_road_width,
    -- Calculated rates
    COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as risky_crossing_rate,
    COUNT(CASE WHEN p.run_red_light THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as run_red_light_rate,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as crosswalk_usage_rate,
    COUNT(CASE WHEN p.phone_using THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as phone_usage_rate,
    -- Heatmap intensity (composite score)
    COALESCE(
        (AVG(v.risky_crossing_ratio) + AVG(v.run_red_light_ratio)) / 2, 
        COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0)
    ) as risk_intensity
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent, c.latitude, c.longitude, 
         c.population_city, c.traffic_mortality, c.literacy_rate, c.gini;

-- v_video_summary: Video-level drilldowns
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

-- v_pedestrian_behavior: Demographic stats per city
CREATE OR REPLACE VIEW v_pedestrian_behavior AS
SELECT 
    c.id as city_id,
    c.city,
    c.country,
    c.continent,
    -- Gender breakdown
    COUNT(CASE WHEN p.gender = 'male' THEN 1 END) as male_count,
    COUNT(CASE WHEN p.gender = 'female' THEN 1 END) as female_count,
    COUNT(CASE WHEN p.gender IS NULL THEN 1 END) as unknown_gender_count,
    COUNT(p.id) as total_pedestrians,
    -- Age statistics
    AVG(p.age) as avg_age,
    MIN(p.age) as min_age,
    MAX(p.age) as max_age,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.age) as median_age,
    -- Behavior patterns
    COUNT(CASE WHEN p.risky_crossing THEN 1 END) as risky_crossing_count,
    COUNT(CASE WHEN p.run_red_light THEN 1 END) as run_red_light_count,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END) as crosswalk_usage_count,
    COUNT(CASE WHEN p.phone_using THEN 1 END) as phone_using_count,
    -- Clothing patterns
    COUNT(CASE WHEN p.shorts THEN 1 END) as shorts_count,
    COUNT(CASE WHEN p.trousers THEN 1 END) as trousers_count,
    COUNT(CASE WHEN p.short_sleeved_shirt THEN 1 END) as short_sleeved_shirt_count,
    COUNT(CASE WHEN p.long_sleeved_shirt THEN 1 END) as long_sleeved_shirt_count,
    -- Carried items
    COUNT(CASE WHEN p.backpack THEN 1 END) as backpack_count,
    COUNT(CASE WHEN p.handbag THEN 1 END) as handbag_count,
    COUNT(CASE WHEN p.umbrella THEN 1 END) as umbrella_count,
    -- Environmental factors
    COUNT(CASE WHEN p.daytime THEN 1 END) as daytime_count,
    COUNT(CASE WHEN NOT p.daytime THEN 1 END) as nighttime_count,
    -- Calculated rates
    COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as risky_crossing_rate,
    COUNT(CASE WHEN p.run_red_light THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as run_red_light_rate,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as crosswalk_usage_rate,
    COUNT(CASE WHEN p.phone_using THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as phone_usage_rate
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent;

-- v_analytics_global: Global-level insight panel
CREATE OR REPLACE VIEW v_analytics_global AS
SELECT 
    af.fact_type,
    af.metric_name,
    ad.dimension_type,
    ad.dimension_value,
    af.value_numeric,
    af.value_percentage,
    af.correlation_coefficient,
    af.sample_size,
    af.data_source,
    -- Add ranking for insights
    RANK() OVER (PARTITION BY af.metric_name ORDER BY af.value_numeric DESC NULLS LAST) as rank_by_numeric,
    RANK() OVER (PARTITION BY af.metric_name ORDER BY af.value_percentage DESC NULLS LAST) as rank_by_percentage,
    -- Add percentiles for context
    PERCENT_RANK() OVER (PARTITION BY af.metric_name ORDER BY af.value_numeric) as percentile_numeric,
    PERCENT_RANK() OVER (PARTITION BY af.metric_name ORDER BY af.value_percentage) as percentile_percentage
FROM analytics_facts af
LEFT JOIN analytics_dimensions ad ON af.dimension_id = ad.id
ORDER BY af.metric_name, af.value_numeric DESC NULLS LAST;

-- v_analytics_by_continent: Continent-level insights
CREATE OR REPLACE VIEW v_analytics_by_continent AS
SELECT 
    c.continent,
    af.fact_type,
    af.metric_name,
    ad.dimension_type,
    ad.dimension_value,
    AVG(af.value_numeric) as avg_value_numeric,
    AVG(af.value_percentage) as avg_value_percentage,
    AVG(af.correlation_coefficient) as avg_correlation_coefficient,
    COUNT(af.id) as fact_count,
    -- City context
    COUNT(DISTINCT c.id) as city_count,
    COUNT(DISTINCT v.id) as video_count,
    COUNT(DISTINCT p.id) as pedestrian_count
FROM analytics_facts af
LEFT JOIN analytics_dimensions ad ON af.dimension_id = ad.id
LEFT JOIN cities c ON c.continent IS NOT NULL
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
WHERE c.continent IS NOT NULL
GROUP BY c.continent, af.fact_type, af.metric_name, ad.dimension_type, ad.dimension_value
ORDER BY c.continent, af.metric_name, avg_value_numeric DESC NULLS LAST;

-- v_analytics_by_city: City-level analytics (joins analytics_facts)
CREATE OR REPLACE VIEW v_analytics_by_city AS
SELECT 
    c.id as city_id,
    c.city,
    c.country,
    c.continent,
    af.fact_type,
    af.metric_name,
    ad.dimension_type,
    ad.dimension_value,
    af.value_numeric,
    af.value_percentage,
    af.correlation_coefficient,
    af.sample_size,
    af.data_source,
    -- City context
    COUNT(DISTINCT v.id) as video_count,
    COUNT(DISTINCT p.id) as pedestrian_count,
    AVG(v.risky_crossing_ratio) as avg_risky_crossing_ratio,
    AVG(v.run_red_light_ratio) as avg_run_red_light_ratio
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
LEFT JOIN analytics_facts af ON 1=1 -- Cross join for global analytics
LEFT JOIN analytics_dimensions ad ON af.dimension_id = ad.id
GROUP BY c.id, c.city, c.country, c.continent, af.fact_type, af.metric_name, 
         ad.dimension_type, ad.dimension_value, af.value_numeric, af.value_percentage,
         af.correlation_coefficient, af.sample_size, af.data_source
ORDER BY c.city, af.metric_name, af.value_numeric DESC NULLS LAST;

-- mv_rank_crossing_speed: Materialized view for Top-N rankings
CREATE MATERIALIZED VIEW mv_rank_crossing_speed AS
SELECT 
    c.id as city_id,
    c.city,
    c.country,
    c.continent,
    c.latitude,
    c.longitude,
    -- Speed rankings
    RANK() OVER (ORDER BY AVG(v.crossing_speed) DESC NULLS LAST) as crossing_speed_rank,
    RANK() OVER (ORDER BY AVG(v.risky_crossing_ratio) DESC NULLS LAST) as risky_crossing_rank,
    RANK() OVER (ORDER BY AVG(v.run_red_light_ratio) DESC NULLS LAST) as run_red_light_rank,
    RANK() OVER (ORDER BY AVG(v.crosswalk_usage_ratio) DESC NULLS LAST) as crosswalk_usage_rank,
    -- Actual values
    AVG(v.crossing_speed) as avg_crossing_speed,
    AVG(v.risky_crossing_ratio) as avg_risky_crossing_ratio,
    AVG(v.run_red_light_ratio) as avg_run_red_light_ratio,
    AVG(v.crosswalk_usage_ratio) as avg_crosswalk_usage_ratio,
    -- Percentiles
    PERCENT_RANK() OVER (ORDER BY AVG(v.crossing_speed)) as crossing_speed_percentile,
    PERCENT_RANK() OVER (ORDER BY AVG(v.risky_crossing_ratio)) as risky_crossing_percentile,
    PERCENT_RANK() OVER (ORDER BY AVG(v.run_red_light_ratio)) as run_red_light_percentile,
    PERCENT_RANK() OVER (ORDER BY AVG(v.crosswalk_usage_ratio)) as crosswalk_usage_percentile,
    -- Context
    COUNT(DISTINCT v.id) as video_count,
    COUNT(DISTINCT p.id) as pedestrian_count
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent, c.latitude, c.longitude;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_mv_rank_crossing_speed_city ON mv_rank_crossing_speed(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_rank_crossing_speed_continent ON mv_rank_crossing_speed(continent);

-- mv_global_insights: Materialized view for global baselines
CREATE MATERIALIZED VIEW mv_global_insights AS
SELECT 
    'global_baselines' as insight_type,
    -- Global averages
    AVG(v.crossing_speed) as global_avg_crossing_speed,
    AVG(v.risky_crossing_ratio) as global_avg_risky_crossing_ratio,
    AVG(v.run_red_light_ratio) as global_avg_run_red_light_ratio,
    AVG(v.crosswalk_usage_ratio) as global_avg_crosswalk_usage_ratio,
    AVG(p.age) as global_avg_pedestrian_age,
    -- Global medians
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.crossing_speed) as global_median_crossing_speed,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.risky_crossing_ratio) as global_median_risky_crossing_ratio,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.run_red_light_ratio) as global_median_run_red_light_ratio,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.crosswalk_usage_ratio) as global_median_crosswalk_usage_ratio,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.age) as global_median_pedestrian_age,
    -- Global percentiles (for context)
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY v.crossing_speed) as global_q1_crossing_speed,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY v.crossing_speed) as global_q3_crossing_speed,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY v.risky_crossing_ratio) as global_q1_risky_crossing_ratio,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY v.risky_crossing_ratio) as global_q3_risky_crossing_ratio,
    -- Counts
    COUNT(DISTINCT c.id) as total_cities,
    COUNT(DISTINCT v.id) as total_videos,
    COUNT(DISTINCT p.id) as total_pedestrians,
    -- Behavioral rates
    COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as global_risky_crossing_rate,
    COUNT(CASE WHEN p.run_red_light THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as global_run_red_light_rate,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as global_crosswalk_usage_rate,
    COUNT(CASE WHEN p.phone_using THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as global_phone_usage_rate
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id;

-- mv_city_insights: Pre-computed insights data per city
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
LEFT JOIN cities c2 ON c2.continent = c.continent  -- For continent counts
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_city ON mv_city_insights(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_continent ON mv_city_insights(continent);

-- v_filter_options: Frontend filter discovery
CREATE OR REPLACE VIEW v_filter_options AS
SELECT 'continent' as filter_type, continent as filter_value, COUNT(*) as count
FROM cities 
WHERE continent IS NOT NULL
GROUP BY continent

UNION ALL

SELECT 'country' as filter_type, country as filter_value, COUNT(*) as count
FROM cities 
GROUP BY country

UNION ALL

SELECT 'weather' as filter_type, main_weather as filter_value, COUNT(*) as count
FROM videos 
WHERE main_weather IS NOT NULL
GROUP BY main_weather

UNION ALL

SELECT 'gender' as filter_type, gender as filter_value, COUNT(*) as count
FROM pedestrians 
WHERE gender IS NOT NULL
GROUP BY gender

UNION ALL

SELECT 'age_range' as filter_type, 
       CASE 
           WHEN age < 18 THEN 'under_18'
           WHEN age BETWEEN 18 AND 30 THEN '18_30'
           WHEN age BETWEEN 31 AND 50 THEN '31_50'
           WHEN age BETWEEN 51 AND 65 THEN '51_65'
           WHEN age > 65 THEN 'over_65'
           ELSE 'unknown'
       END as filter_value,
       COUNT(*) as count
FROM pedestrians 
WHERE age IS NOT NULL
GROUP BY 
    CASE 
        WHEN age < 18 THEN 'under_18'
        WHEN age BETWEEN 18 AND 30 THEN '18_30'
        WHEN age BETWEEN 31 AND 50 THEN '31_50'
        WHEN age BETWEEN 51 AND 65 THEN '51_65'
        WHEN age > 65 THEN 'over_65'
        ELSE 'unknown'
    END

UNION ALL

SELECT 'clothing_type' as filter_type, 'shorts' as filter_value, COUNT(*) as count
FROM pedestrians WHERE shorts = true
UNION ALL
SELECT 'clothing_type' as filter_type, 'trousers' as filter_value, COUNT(*) as count
FROM pedestrians WHERE trousers = true
UNION ALL
SELECT 'clothing_type' as filter_type, 'short_sleeved_shirt' as filter_value, COUNT(*) as count
FROM pedestrians WHERE short_sleeved_shirt = true
UNION ALL
SELECT 'clothing_type' as filter_type, 'long_sleeved_shirt' as filter_value, COUNT(*) as count
FROM pedestrians WHERE long_sleeved_shirt = true

UNION ALL

SELECT 'behavior' as filter_type, 'risky_crossing' as filter_value, COUNT(*) as count
FROM pedestrians WHERE risky_crossing = true
UNION ALL
SELECT 'behavior' as filter_type, 'run_red_light' as filter_value, COUNT(*) as count
FROM pedestrians WHERE run_red_light = true
UNION ALL
SELECT 'behavior' as filter_type, 'crosswalk_usage' as filter_value, COUNT(*) as count
FROM pedestrians WHERE crosswalk_use_or_not = true
UNION ALL
SELECT 'behavior' as filter_type, 'phone_usage' as filter_value, COUNT(*) as count
FROM pedestrians WHERE phone_using = true

UNION ALL

SELECT 'time_of_day' as filter_type, 'daytime' as filter_value, COUNT(*) as count
FROM pedestrians WHERE daytime = true
UNION ALL
SELECT 'time_of_day' as filter_type, 'nighttime' as filter_value, COUNT(*) as count
FROM pedestrians WHERE daytime = false

ORDER BY filter_type, count DESC;

-- ===============================================
-- FUNCTIONS FOR DATA AGGREGATION
-- ===============================================

-- Function to safely parse numeric values from CSV
CREATE OR REPLACE FUNCTION safe_numeric(input_text TEXT)
RETURNS DECIMAL AS $$
BEGIN
    IF input_text IS NULL OR input_text = '' THEN
        RETURN NULL;
    END IF;
    
    BEGIN
        RETURN input_text::DECIMAL;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to safely parse boolean values from CSV
CREATE OR REPLACE FUNCTION safe_boolean(input_text TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF input_text IS NULL OR input_text = '' THEN
        RETURN NULL;
    END IF;
    
    RETURN CASE 
        WHEN LOWER(input_text) IN ('1', 'true', 'yes') THEN TRUE
        WHEN LOWER(input_text) IN ('0', 'false', 'no') THEN FALSE
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_rank_crossing_speed;
    REFRESH MATERIALIZED VIEW mv_global_insights;
    REFRESH MATERIALIZED VIEW mv_city_insights;
    RAISE NOTICE 'Materialized views refreshed successfully';
END;
$$ LANGUAGE plpgsql;

-- Function to get city insights for frontend
CREATE OR REPLACE FUNCTION get_city_insights(city_id_param INTEGER)
RETURNS TABLE (
    city_name VARCHAR(255),
    country VARCHAR(255),
    continent VARCHAR(255),
    total_videos BIGINT,
    total_pedestrians BIGINT,
    avg_risky_crossing_rate DECIMAL,
    avg_run_red_light_rate DECIMAL,
    avg_crosswalk_usage_rate DECIMAL,
    risk_intensity DECIMAL,
    global_rank BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vs.city,
        vs.country,
        vs.continent,
        vs.total_videos,
        vs.total_pedestrians,
        vs.avg_risky_crossing_ratio,
        vs.avg_run_red_light_ratio,
        vs.avg_crosswalk_usage_ratio,
        vs.risk_intensity,
        mv.crossing_speed_rank
    FROM v_city_summary vs
    LEFT JOIN mv_rank_crossing_speed mv ON vs.id = mv.city_id
    WHERE vs.id = city_id_param;
END;
$$ LANGUAGE plpgsql;

-- Function to get top N cities by metric
CREATE OR REPLACE FUNCTION get_top_cities_by_metric(
    metric_name VARCHAR(255),
    limit_count INTEGER DEFAULT 10
)
RETURNS TABLE (
    city_name VARCHAR(255),
    country VARCHAR(255),
    continent VARCHAR(255),
    metric_value DECIMAL,
    rank_position BIGINT
) AS $$
BEGIN
    CASE metric_name
        WHEN 'crossing_speed' THEN
            RETURN QUERY
            SELECT mv.city, mv.country, mv.continent, mv.avg_crossing_speed, mv.crossing_speed_rank
            FROM mv_rank_crossing_speed mv
            WHERE mv.avg_crossing_speed IS NOT NULL
            ORDER BY mv.crossing_speed_rank
            LIMIT limit_count;
            
        WHEN 'risky_crossing' THEN
            RETURN QUERY
            SELECT mv.city, mv.country, mv.continent, mv.avg_risky_crossing_ratio, mv.risky_crossing_rank
            FROM mv_rank_crossing_speed mv
            WHERE mv.avg_risky_crossing_ratio IS NOT NULL
            ORDER BY mv.risky_crossing_rank
            LIMIT limit_count;
            
        WHEN 'run_red_light' THEN
            RETURN QUERY
            SELECT mv.city, mv.country, mv.continent, mv.avg_run_red_light_ratio, mv.run_red_light_rank
            FROM mv_rank_crossing_speed mv
            WHERE mv.avg_run_red_light_ratio IS NOT NULL
            ORDER BY mv.run_red_light_rank
            LIMIT limit_count;
            
        WHEN 'crosswalk_usage' THEN
            RETURN QUERY
            SELECT mv.city, mv.country, mv.continent, mv.avg_crosswalk_usage_ratio, mv.crosswalk_usage_rank
            FROM mv_rank_crossing_speed mv
            WHERE mv.avg_crosswalk_usage_ratio IS NOT NULL
            ORDER BY mv.crosswalk_usage_rank
            LIMIT limit_count;
            
        ELSE
            RAISE EXCEPTION 'Unknown metric: %', metric_name;
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Triggers for automatic timestamp updates
CREATE TRIGGER update_cities_updated_at BEFORE UPDATE ON cities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pedestrians_updated_at BEFORE UPDATE ON pedestrians
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analytics_facts_updated_at BEFORE UPDATE ON analytics_facts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
