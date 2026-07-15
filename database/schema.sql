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

-- ===============================================
-- TEMPORAL TRACKING TABLES (must be before videos)
-- ===============================================

-- Import batches table - tracks each data import run
-- Created before videos table because videos references it
CREATE TABLE import_batches (
    id SERIAL PRIMARY KEY,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    description TEXT,
    file_count INTEGER,
    record_count INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_import_batches_date ON import_batches(import_date DESC);

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
    -- Localization provenance (real coordinates from PedX-Insight --mode localize,
    -- imported by scripts/import-video-coordinates.js)
    localization_confidence VARCHAR(16), -- high / medium / low
    street_name VARCHAR(255),
    localization_status VARCHAR(32), -- ok / no_position / osm_env_not_configured / ...
    localization_spread_m NUMERIC, -- confidence_spread_m: uncertainty radius (metres)
    localization_candidates JSONB, -- ranked candidates [{rank,latitude,longitude,street_names[],support,google_maps_url}]
    -- Temporal tracking (for historical data analysis)
    data_collected_date DATE, -- When data was originally collected
    import_batch_id INTEGER REFERENCES import_batches(id), -- Which import batch added this data
    first_imported_at TIMESTAMP, -- First time this video was imported
    last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Last time this video was updated
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
-- TEMPORAL TRACKING TABLES (continued)
-- ===============================================

-- Video update history - tracks when videos were updated (optional)
-- Created after videos table because it references videos
CREATE TABLE video_update_history (
    id SERIAL PRIMARY KEY,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    import_batch_id INTEGER REFERENCES import_batches(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Store key metrics that changed
    risky_crossing_ratio DECIMAL(5, 4),
    run_red_light_ratio DECIMAL(5, 4),
    crosswalk_usage_ratio DECIMAL(5, 4),
    total_pedestrians INTEGER,
    -- Store full snapshot as JSONB for flexibility
    metrics_snapshot JSONB
);

CREATE INDEX idx_video_history_video ON video_update_history(video_id, updated_at);
CREATE INDEX idx_video_history_batch ON video_update_history(import_batch_id);

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
CREATE INDEX idx_videos_temporal ON videos(data_collected_date, import_batch_id);
CREATE INDEX idx_videos_first_imported ON videos(first_imported_at);

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
-- NOTE: video-level and pedestrian-level metrics are aggregated in SEPARATE CTEs joined on
-- city_id. Joining cities -> videos -> pedestrians in one query and then AVG()-ing video columns
-- fans out each video row once per pedestrian, silently pedestrian-weighting every per-video
-- average. See scripts/migrate-fix-aggregation-fanout.sql.
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
        COUNT(DISTINCT import_batch_id) AS import_batch_count
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
    vid.import_batch_count
FROM cities c
LEFT JOIN vid ON vid.city_id = c.id
LEFT JOIN ped ON ped.city_id = c.id;

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
    c.id as city_id,
    c.city,
    c.country,
    c.continent,
    c.latitude,
    c.longitude,
    -- Speed rankings
    RANK() OVER (ORDER BY vid.avg_crossing_speed DESC NULLS LAST) as crossing_speed_rank,
    RANK() OVER (ORDER BY vid.avg_risky_crossing_ratio DESC NULLS LAST) as risky_crossing_rank,
    RANK() OVER (ORDER BY vid.avg_run_red_light_ratio DESC NULLS LAST) as run_red_light_rank,
    RANK() OVER (ORDER BY vid.avg_crosswalk_usage_ratio DESC NULLS LAST) as crosswalk_usage_rank,
    -- Actual values
    vid.avg_crossing_speed,
    vid.avg_risky_crossing_ratio,
    vid.avg_run_red_light_ratio,
    vid.avg_crosswalk_usage_ratio,
    -- Percentiles
    PERCENT_RANK() OVER (ORDER BY vid.avg_crossing_speed) as crossing_speed_percentile,
    PERCENT_RANK() OVER (ORDER BY vid.avg_risky_crossing_ratio) as risky_crossing_percentile,
    PERCENT_RANK() OVER (ORDER BY vid.avg_run_red_light_ratio) as run_red_light_percentile,
    PERCENT_RANK() OVER (ORDER BY vid.avg_crosswalk_usage_ratio) as crosswalk_usage_percentile,
    -- Context
    COALESCE(vid.video_count, 0) as video_count,
    COALESCE(ped.pedestrian_count, 0) as pedestrian_count
FROM cities c
LEFT JOIN vid ON vid.city_id = c.id
LEFT JOIN ped ON ped.city_id = c.id;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_mv_rank_crossing_speed_city ON mv_rank_crossing_speed(city_id);
CREATE INDEX IF NOT EXISTS idx_mv_rank_crossing_speed_continent ON mv_rank_crossing_speed(continent);

-- mv_global_insights: Materialized view for global baselines
-- video-level and pedestrian-level baselines computed separately to avoid pedestrian-count
-- weighting of the per-video averages/medians (see migrate-fix-aggregation-fanout.sql).
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

-- mv_city_insights: Pre-computed insights data per city
-- video-level and pedestrian-level metrics aggregated in separate CTEs (no fan-out).
-- Adds crosswalk_usage_rank so /api/metrics/crosswalk_usage can read it here.
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

-- ===============================================
-- TEMPORAL DATA FUNCTIONS
-- ===============================================

-- Function to get city summary at a specific point in time
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
    -- Aggregate videos and pedestrians (as-of target_date) in separate CTEs so per-video
    -- averages are not pedestrian-count weighted (see migrate-fix-aggregation-fanout.sql).
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

-- Function to compare current data with historical data
CREATE OR REPLACE FUNCTION compare_city_data_current_vs_date(
    target_date DATE,
    city_name_param VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    city VARCHAR,
    country VARCHAR,
    current_total_videos BIGINT,
    current_avg_risky_crossing DECIMAL,
    current_avg_crossing_speed DECIMAL,
    current_risky_crossing_rate DECIMAL,
    historical_total_videos BIGINT,
    historical_avg_risky_crossing DECIMAL,
    historical_avg_crossing_speed DECIMAL,
    historical_risky_crossing_rate DECIMAL,
    video_count_change BIGINT,
    risky_crossing_change DECIMAL,
    crossing_speed_change DECIMAL,
    change_period_days INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH current_data AS (
        SELECT * FROM v_city_summary
        WHERE (city_name_param IS NULL OR city = city_name_param)
    ),
    historical_data AS (
        SELECT * FROM v_city_summary_at_date(target_date)
        WHERE (city_name_param IS NULL OR city = city_name_param)
    )
    SELECT 
        COALESCE(c.city, h.city) as city,
        COALESCE(c.country, h.country) as country,
        c.total_videos as current_total_videos,
        c.avg_risky_crossing_ratio as current_avg_risky_crossing,
        c.avg_crossing_speed as current_avg_crossing_speed,
        c.risky_crossing_rate as current_risky_crossing_rate,
        h.total_videos as historical_total_videos,
        h.avg_risky_crossing_ratio as historical_avg_risky_crossing,
        h.avg_crossing_speed as historical_avg_crossing_speed,
        h.risky_crossing_rate as historical_risky_crossing_rate,
        (c.total_videos - COALESCE(h.total_videos, 0)) as video_count_change,
        (c.avg_risky_crossing_ratio - COALESCE(h.avg_risky_crossing_ratio, 0)) as risky_crossing_change,
        (c.avg_crossing_speed - COALESCE(h.avg_crossing_speed, 0)) as crossing_speed_change,
        (CURRENT_DATE - target_date) as change_period_days
    FROM current_data c
    FULL OUTER JOIN historical_data h ON c.city = h.city AND c.country = h.country;
END;
$$ LANGUAGE plpgsql;

-- Function to get import batch statistics
CREATE OR REPLACE FUNCTION get_import_batch_stats()
RETURNS TABLE (
    batch_id INTEGER,
    import_date TIMESTAMP,
    description TEXT,
    video_count BIGINT,
    city_count BIGINT,
    pedestrian_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ib.id,
        ib.import_date,
        ib.description,
        COUNT(DISTINCT v.id) as video_count,
        COUNT(DISTINCT v.city_id) as city_count,
        COUNT(DISTINCT p.id) as pedestrian_count
    FROM import_batches ib
    LEFT JOIN videos v ON ib.id = v.import_batch_id
    LEFT JOIN pedestrians p ON v.id = p.video_id
    GROUP BY ib.id, ib.import_date, ib.description
    ORDER BY ib.import_date DESC;
END;
$$ LANGUAGE plpgsql;
