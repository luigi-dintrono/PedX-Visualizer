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
    -- MEASURED per-video median walking speed (m/s) from PedX-Insight [S1] dense tracking.
    -- Distinct from crossing_speed (an imported city-level constant). NULL when the video
    -- was analyzed before the dense-tracking pass (see scripts/migrate-add-measured-speed.sql).
    measured_walking_speed_mps NUMERIC,
    -- MEASURED median curb-to-curb crossing speed (m/s) of reliable crossers, PedX-Insight [S1].
    -- The like-for-like counterpart of the imported `crossing_speed` constant; NULL when no
    -- crossing was measurable. See scripts/migrate-add-video-insights.sql.
    measured_crossing_speed_mps NUMERIC,
    measured_crossing_speed_n INTEGER, -- sample size behind measured_crossing_speed_mps
    -- Analysis pipeline that produced this row: 'dense_v2' (dense tracking, measured
    -- kinematics) or 'legacy_1hz'. NULL for videos imported before the column existed.
    -- total_pedestrians is NOT comparable across versions: the legacy 1 Hz tracker
    -- fragmented and under-counted. Group or filter on this column rather than
    -- averaging the eras together.
    pipeline_version TEXT,
    -- Surrogate-safety (PET) conflicts [I1]
    pet_severe_conflicts INTEGER,
    pet_moderate_conflicts INTEGER,
    pet_queued_interactions INTEGER,
    pet_min_s NUMERIC,
    -- Vehicle kinematics and flow [V8] / [V11]
    vehicle_median_speed_mps NUMERIC,
    vehicle_p85_speed_mps NUMERIC,
    mean_headway_s NUMERIC,
    platoon_frac NUMERIC,
    vehicle_flow_per_min NUMERIC,
    -- Signal-phase behaviour [P10]
    anticipatory_start_frac NUMERIC,
    mean_red_exposure_s NUMERIC,
    -- Hesitation / micro-events [P11]
    hesitation_rate NUMERIC,
    aborted_start_rate NUMERIC,
    evasive_event_count INTEGER,
    -- Social groups [I2] / [I3]
    n_social_groups INTEGER,
    grouped_pedestrians INTEGER,
    -- Pose: looking behaviour and gait [P12]
    look_before_cross_frac NUMERIC, -- fraction who turned their head before crossing
    looked_both_ways_frac NUMERIC,
    median_cadence_hz NUMERIC,
    cadence_n INTEGER, -- sample size behind median_cadence_hz
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
    -- Estimated camera ROUTE through the city ([[lat,lon], ...] WGS84, ordered), recovered
    -- by visual odometry and snapped to the OSM graph. These are walking-tour videos, so
    -- this is the path actually walked. NULL when no route was estimated — which is NOT
    -- the same as an empty route. See scripts/migrate-add-localization-route.sql.
    localization_route JSONB,
    localization_route_length_m NUMERIC,
    localization_trajectory_source TEXT, -- e.g. 'vo' (visual odometry)
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
    -- MEASURED per-pedestrian kinematics from PedX-Insight [S1] dense foot-point
    -- trajectories. NULL when no reliable trajectory exists (not fabricated).
    -- See scripts/migrate-add-pedestrian-speed.sql.
    walking_speed_mps NUMERIC,
    crossing_speed_mps NUMERIC, -- over the crossing segment; NULL for non-crossers
    decision_delay_s NUMERIC,   -- kerb-stationary to crossing start
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
    -- The real detector class is the single CSV column "human hauler". The legacy
    -- `human` / `hauler` pair below is an old split of that one name and is empty in
    -- every current CSV; both are retained unchanged for backward compatibility.
    human_hauler BOOLEAN,
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
-- Partial: only a small minority of videos are localized, and every read filters NOT NULL.
CREATE INDEX idx_videos_localization_route ON videos ((localization_route IS NOT NULL)) WHERE localization_route IS NOT NULL;

-- Pedestrians indexes
CREATE INDEX idx_pedestrians_video_id ON pedestrians(video_id);
CREATE INDEX idx_pedestrians_track_id ON pedestrians(track_id);
CREATE INDEX idx_pedestrians_gender ON pedestrians(gender);
CREATE INDEX idx_pedestrians_age ON pedestrians(age);
CREATE INDEX idx_pedestrians_behavior ON pedestrians(risky_crossing, run_red_light, crosswalk_use_or_not);
-- Partial: usable queries filter on NOT NULL, and skipping NULLs keeps these small
-- on rows imported before the [S1] speed module ran.
CREATE INDEX idx_pedestrians_walking_speed ON pedestrians (walking_speed_mps) WHERE walking_speed_mps IS NOT NULL;
CREATE INDEX idx_pedestrians_crossing_speed ON pedestrians (crossing_speed_mps) WHERE crossing_speed_mps IS NOT NULL;

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
-- Mirrored verbatim from the live database (pg_get_viewdef) so a fresh setup-db builds
-- the exact shape the app queries. The insight-metric columns appended by
-- scripts/migrate-city-insight-metrics.sql are load-bearing: /api/data selects them
-- (DATA_COLUMNS), so a schema.sql missing them yields a database where every
-- /api/data request 500s. Regenerate with pg_get_viewdef rather than editing by hand.
-- Mirrored verbatim from the live database (pg_get_viewdef) so a fresh setup-db builds
-- the exact shape the app queries. The insight-metric columns appended by
-- scripts/migrate-city-insight-metrics.sql are load-bearing: /api/data selects them
-- (DATA_COLUMNS), so a schema.sql missing them yields a database where every
-- /api/data request 500s. Regenerate with pg_get_viewdef rather than editing by hand.
CREATE OR REPLACE VIEW v_city_summary AS
WITH vid AS (
         SELECT videos.city_id,
            count(*) AS total_videos,
            avg(videos.duration_seconds) AS avg_video_duration,
            avg(videos.total_pedestrians) AS avg_pedestrians_per_video,
            avg(videos.risky_crossing_ratio) AS avg_risky_crossing_ratio,
            avg(videos.run_red_light_ratio) AS avg_run_red_light_ratio,
            avg(videos.crosswalk_usage_ratio) AS avg_crosswalk_usage_ratio,
            avg(videos.crossing_speed) AS avg_crossing_speed,
            avg(videos.crossing_time) AS avg_crossing_time,
            avg(videos.phone_usage_ratio) AS avg_phone_usage_ratio,
            avg(videos.avg_road_width) AS avg_road_width,
            min(videos.data_collected_date) AS earliest_data_date,
            max(videos.data_collected_date) AS latest_data_date,
            min(videos.first_imported_at) AS earliest_import_date,
            max(videos.last_updated_at) AS latest_update_date,
            count(DISTINCT videos.import_batch_id) AS import_batch_count,
            avg(videos.measured_walking_speed_mps) AS avg_measured_walking_speed,
            count(videos.measured_walking_speed_mps) AS measured_speed_video_count,
            sum(videos.measured_crossing_speed_mps * videos.measured_crossing_speed_n::numeric) / NULLIF(sum(videos.measured_crossing_speed_n) FILTER (WHERE videos.measured_crossing_speed_mps IS NOT NULL), 0)::numeric AS avg_measured_crossing_speed,
            sum(videos.measured_crossing_speed_n) FILTER (WHERE videos.measured_crossing_speed_mps IS NOT NULL) AS measured_crossing_sample,
            avg(videos.look_before_cross_frac) AS avg_look_before_cross,
            avg(videos.looked_both_ways_frac) AS avg_looked_both_ways,
            sum(videos.median_cadence_hz * videos.cadence_n::numeric) / NULLIF(sum(videos.cadence_n) FILTER (WHERE videos.median_cadence_hz IS NOT NULL), 0)::numeric AS avg_cadence_hz,
            sum(videos.cadence_n) FILTER (WHERE videos.median_cadence_hz IS NOT NULL) AS cadence_sample,
            sum(videos.pet_severe_conflicts) AS total_severe_conflicts,
            sum(videos.pet_queued_interactions) AS total_queued_interactions,
            avg(videos.hesitation_rate) AS avg_hesitation_rate,
            avg(videos.vehicle_median_speed_mps) AS avg_vehicle_speed,
            avg(videos.mean_headway_s) AS avg_headway_s,
            sum(videos.n_social_groups) AS total_social_groups,
            count(videos.measured_crossing_speed_mps) AS measured_crossing_video_count,
            sum(videos.total_crossed_pedestrians) FILTER (WHERE videos.look_before_cross_frac IS NOT NULL) AS look_before_cross_sample,
            count(videos.look_before_cross_frac) AS look_before_cross_video_count,
            sum(videos.total_vehicles) FILTER (WHERE videos.vehicle_median_speed_mps IS NOT NULL) AS vehicle_speed_sample,
            count(videos.vehicle_median_speed_mps) AS vehicle_speed_video_count,
            sum(videos.total_pedestrians) FILTER (WHERE videos.pet_severe_conflicts IS NOT NULL) AS pet_exposure_pedestrians,
            count(videos.pet_severe_conflicts) AS pet_video_count,
            100::double precision * sum(videos.pet_severe_conflicts)::double precision / NULLIF(sum(videos.total_pedestrians) FILTER (WHERE videos.pet_severe_conflicts IS NOT NULL), 0)::double precision AS severe_conflicts_per_100_ped,
            sum(videos.total_pedestrians) FILTER (WHERE videos.n_social_groups IS NOT NULL AND videos.pipeline_version = 'dense_v2'::text) AS social_dense_pedestrians,
            count(*) FILTER (WHERE videos.n_social_groups IS NOT NULL AND videos.pipeline_version = 'dense_v2'::text) AS social_dense_video_count,
            sum(videos.grouped_pedestrians) FILTER (WHERE videos.pipeline_version = 'dense_v2'::text) AS grouped_pedestrians_dense,
            sum(videos.grouped_pedestrians) FILTER (WHERE videos.pipeline_version = 'dense_v2'::text)::double precision / NULLIF(sum(videos.total_pedestrians) FILTER (WHERE videos.n_social_groups IS NOT NULL AND videos.pipeline_version = 'dense_v2'::text), 0)::double precision AS grouped_pedestrian_share_dense,
            avg(videos.hesitation_rate) FILTER (WHERE videos.pipeline_version = 'dense_v2'::text) AS avg_hesitation_rate_dense,
            sum(videos.total_pedestrians) FILTER (WHERE videos.hesitation_rate IS NOT NULL AND videos.pipeline_version = 'dense_v2'::text) AS hesitation_dense_pedestrians,
            count(*) FILTER (WHERE videos.hesitation_rate IS NOT NULL AND videos.pipeline_version = 'dense_v2'::text) AS hesitation_dense_video_count,
            count(videos.avg_road_width) AS road_width_video_count,
            sum(videos.total_vehicles) FILTER (WHERE videos.mean_headway_s IS NOT NULL) AS headway_vehicle_sample,
            count(videos.mean_headway_s) AS headway_video_count,
            sum(videos.total_crossed_pedestrians) FILTER (WHERE videos.looked_both_ways_frac IS NOT NULL) AS looked_both_ways_sample,
            sum(videos.total_pedestrians) FILTER (WHERE videos.pet_queued_interactions IS NOT NULL) AS queued_exposure_pedestrians,
            count(*) FILTER (WHERE videos.pipeline_version = 'dense_v2'::text) AS dense_video_count,
            count(*) FILTER (WHERE videos.pipeline_version = 'legacy_1hz'::text) AS legacy_video_count
           FROM videos
          GROUP BY videos.city_id
        ), ped AS (
         SELECT v.city_id,
            count(p.id) AS total_pedestrians,
            avg(p.age) AS avg_pedestrian_age,
            count(*) FILTER (WHERE p.risky_crossing)::double precision / NULLIF(count(p.id), 0)::double precision AS risky_crossing_rate,
            count(*) FILTER (WHERE p.run_red_light)::double precision / NULLIF(count(p.id), 0)::double precision AS run_red_light_rate,
            count(*) FILTER (WHERE p.crosswalk_use_or_not)::double precision / NULLIF(count(p.id), 0)::double precision AS crosswalk_usage_rate,
            count(*) FILTER (WHERE p.phone_using)::double precision / NULLIF(count(p.id), 0)::double precision AS phone_usage_rate,
            count(p.age) AS age_sample,
            count(p.walking_speed_mps) AS measured_walking_ped_sample
           FROM pedestrians p
             JOIN videos v ON v.id = p.video_id
          GROUP BY v.city_id
        )
 SELECT c.id,
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
    COALESCE(vid.total_videos, 0::bigint) AS total_videos,
    COALESCE(ped.total_pedestrians, 0::bigint) AS total_pedestrians,
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
    COALESCE(((vid.avg_risky_crossing_ratio + vid.avg_run_red_light_ratio) / 2::numeric)::double precision, ped.risky_crossing_rate) AS risk_intensity,
    vid.earliest_data_date,
    vid.latest_data_date,
    vid.earliest_import_date,
    vid.latest_update_date,
    vid.import_batch_count,
    vid.avg_measured_walking_speed,
    COALESCE(vid.measured_speed_video_count, 0::bigint) AS measured_speed_video_count,
    vid.avg_measured_crossing_speed,
    vid.measured_crossing_sample,
    vid.avg_look_before_cross,
    vid.avg_looked_both_ways,
    vid.avg_cadence_hz,
    vid.cadence_sample,
    vid.total_severe_conflicts,
    vid.total_queued_interactions,
    vid.avg_hesitation_rate,
    vid.avg_vehicle_speed,
    vid.avg_headway_s,
    vid.total_social_groups,
    ped.age_sample,
    ped.measured_walking_ped_sample,
    vid.measured_crossing_video_count,
    vid.look_before_cross_sample,
    vid.look_before_cross_video_count,
    vid.vehicle_speed_sample,
    vid.vehicle_speed_video_count,
    vid.pet_exposure_pedestrians,
    vid.pet_video_count,
    vid.severe_conflicts_per_100_ped,
    vid.social_dense_pedestrians,
    vid.social_dense_video_count,
    vid.grouped_pedestrians_dense,
    vid.grouped_pedestrian_share_dense,
    vid.avg_hesitation_rate_dense,
    vid.hesitation_dense_pedestrians,
    vid.hesitation_dense_video_count,
    vid.road_width_video_count,
    vid.headway_vehicle_sample,
    vid.headway_video_count,
    vid.looked_both_ways_sample,
    vid.queued_exposure_pedestrians,
    vid.dense_video_count,
    vid.legacy_video_count
   FROM cities c
     LEFT JOIN vid ON vid.city_id = c.id
     LEFT JOIN ped ON ped.city_id = c.id
;

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

-- mv_city_insights: Pre-computed insights data per city
-- video-level and pedestrian-level metrics aggregated in separate CTEs (no fan-out).
-- Adds crosswalk_usage_rank so /api/metrics/crosswalk_usage can read it here.
-- Mirrored verbatim from the live database (pg_get_viewdef). See the note on v_city_summary.
-- Mirrored verbatim from the live database (pg_get_viewdef). See the note on v_city_summary.
CREATE MATERIALIZED VIEW mv_city_insights AS
WITH vid AS (
         SELECT videos.city_id,
            count(*) AS video_count,
            avg(videos.crossing_speed) AS avg_crossing_speed,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.crossing_speed::double precision)) AS median_crossing_speed,
            avg(videos.risky_crossing_ratio) AS avg_risky_crossing_ratio,
            avg(videos.run_red_light_ratio) AS avg_run_red_light_ratio,
            avg(videos.crosswalk_usage_ratio) AS avg_crosswalk_usage_ratio,
            avg(videos.avg_road_width) AS avg_road_width,
            avg(videos.crossing_time) AS avg_crossing_time,
            mode() WITHIN GROUP (ORDER BY videos.main_weather) AS dominant_weather,
            count(DISTINCT videos.main_weather) AS weather_variety,
            string_agg(DISTINCT videos.top3_vehicles, ', '::text) FILTER (WHERE videos.top3_vehicles IS NOT NULL) AS vehicles_list,
            count(*) FILTER (WHERE videos.localization_status::text = 'ok'::text) AS videos_localized,
            (array_agg(videos.street_name) FILTER (WHERE videos.localization_status::text = 'ok'::text AND videos.street_name IS NOT NULL))[1] AS localized_street,
            avg(videos.total_pedestrians) AS avg_pedestrians_per_video,
            avg(videos.total_vehicles) AS avg_vehicles_per_video,
            avg(videos.traffic_light_prob) AS avg_traffic_light_prob,
            avg(videos.crosswalk_prob) AS avg_crosswalk_prob,
            avg(videos.sidewalk_prob) AS avg_sidewalk_prob,
            avg(videos.accident_prob) AS avg_accident_prob,
            avg(videos.crack_prob) AS avg_crack_prob,
            avg(videos.potholes_prob) AS avg_potholes_prob,
            avg(videos.traffic_signs_ratio) AS avg_traffic_signs_ratio,
            avg(videos.measured_walking_speed_mps) AS avg_measured_walking_speed,
            avg(videos.measured_crossing_speed_mps) AS avg_measured_crossing_speed,
            sum(videos.measured_crossing_speed_n) AS measured_crossing_sample,
            avg(videos.look_before_cross_frac) AS avg_look_before_cross,
            avg(videos.looked_both_ways_frac) AS avg_looked_both_ways,
            avg(videos.median_cadence_hz) AS avg_cadence_hz,
            sum(videos.cadence_n) AS cadence_sample,
            sum(videos.pet_severe_conflicts) AS total_severe_conflicts,
            sum(videos.pet_queued_interactions) AS total_queued_interactions,
            avg(videos.hesitation_rate) AS avg_hesitation_rate,
            avg(videos.vehicle_median_speed_mps) AS avg_vehicle_speed,
            avg(videos.mean_headway_s) AS avg_headway_s,
            sum(videos.n_social_groups) AS total_social_groups,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (videos.measured_walking_speed_mps::double precision)) AS median_measured_walking_speed,
            count(videos.measured_walking_speed_mps) AS measured_speed_video_count
           FROM videos
          GROUP BY videos.city_id
        ), ped AS (
         SELECT v.city_id,
            count(p.id) AS pedestrian_count,
            avg(p.age) AS avg_age,
            count(*) FILTER (WHERE p.gender::text = 'male'::text)::double precision / NULLIF(count(p.id), 0)::double precision AS male_ratio,
            count(*) FILTER (WHERE p.phone_using)::double precision / NULLIF(count(p.id), 0)::double precision AS phone_usage_ratio
           FROM pedestrians p
             JOIN videos v ON v.id = p.video_id
          GROUP BY v.city_id
        ), base AS (
         SELECT c.id AS city_id,
            c.city,
            c.country,
            c.continent,
            c.med_age AS city_med_age,
            COALESCE(vid.video_count, 0::bigint) AS video_count,
            COALESCE(ped.pedestrian_count, 0::bigint) AS pedestrian_count,
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
            COALESCE(vid.measured_speed_video_count, 0::bigint) AS measured_speed_video_count,
            vid.avg_measured_crossing_speed,
            vid.measured_crossing_sample,
            vid.avg_look_before_cross,
            vid.avg_looked_both_ways,
            vid.avg_cadence_hz,
            vid.cadence_sample,
            vid.total_severe_conflicts,
            vid.total_queued_interactions,
            vid.avg_hesitation_rate,
            vid.avg_vehicle_speed,
            vid.avg_headway_s,
            vid.total_social_groups
           FROM cities c
             LEFT JOIN vid ON vid.city_id = c.id
             LEFT JOIN ped ON ped.city_id = c.id
        ), measured_ranked AS (
         SELECT base_1.city_id,
            rank() OVER (ORDER BY base_1.avg_measured_walking_speed DESC) AS measured_walking_speed_rank
           FROM base base_1
          WHERE base_1.avg_measured_walking_speed IS NOT NULL
        )
 SELECT base.city_id,
    base.city,
    base.country,
    base.continent,
    base.city_med_age,
    base.video_count,
    base.pedestrian_count,
    base.avg_crossing_speed,
    rank() OVER (ORDER BY base.avg_crossing_speed DESC NULLS LAST) AS speed_rank,
    base.median_crossing_speed,
    base.avg_risky_crossing_ratio,
    base.avg_run_red_light_ratio,
    base.avg_crosswalk_usage_ratio,
    rank() OVER (ORDER BY base.avg_risky_crossing_ratio DESC NULLS LAST) AS risky_rank,
    rank() OVER (ORDER BY base.avg_run_red_light_ratio DESC NULLS LAST) AS red_light_rank,
    rank() OVER (ORDER BY base.avg_crosswalk_usage_ratio DESC NULLS LAST) AS crosswalk_usage_rank,
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
    rank() OVER (PARTITION BY base.continent ORDER BY base.avg_crossing_speed DESC NULLS LAST) AS continent_speed_rank,
    ( SELECT count(*) AS count
           FROM cities c2
          WHERE c2.continent::text = base.continent::text) AS cities_in_continent,
    base.avg_measured_walking_speed,
    base.median_measured_walking_speed,
    base.measured_speed_video_count,
    measured_ranked.measured_walking_speed_rank,
    base.avg_measured_crossing_speed,
    base.measured_crossing_sample,
    base.avg_look_before_cross,
    base.avg_looked_both_ways,
    base.avg_cadence_hz,
    base.cadence_sample,
    base.total_severe_conflicts,
    base.total_queued_interactions,
    base.avg_hesitation_rate,
    base.avg_vehicle_speed,
    base.avg_headway_s,
    base.total_social_groups
   FROM base
     LEFT JOIN measured_ranked ON measured_ranked.city_id = base.city_id
;

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
-- Materialized snapshot of v_city_summary — the hot read model behind /api/data (every
-- globe heatmap paint) and /api/cities (every page load). The plain view is kept as the
-- single source of truth for the aggregation; this MV is refreshed after every import
-- (scripts/migrate-materialize-city-summary.sql).
DROP MATERIALIZED VIEW IF EXISTS mv_city_summary;
CREATE MATERIALIZED VIEW mv_city_summary AS
SELECT * FROM v_city_summary;

CREATE UNIQUE INDEX idx_mv_city_summary_id ON mv_city_summary(id);
CREATE INDEX idx_mv_city_summary_city ON mv_city_summary(city);
CREATE INDEX idx_mv_city_summary_continent ON mv_city_summary(continent);
CREATE INDEX idx_mv_city_summary_coords ON mv_city_summary(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS VOID AS $$
BEGIN
    -- Concurrent refresh keeps /api/data and /api/cities readable during the refresh;
    -- falls back to a plain refresh (e.g. right after creation).
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_city_summary;
    EXCEPTION WHEN OTHERS THEN
        REFRESH MATERIALIZED VIEW mv_city_summary;
    END;
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
    -- Cast every column to its declared RETURNS TABLE type: v_city_summary.risk_intensity
    -- is `double precision` but declared DECIMAL above, which made this function raise
    -- 42804 on every call. See scripts/migrate-fix-plpgsql-result-types.sql.
    SELECT
        vs.city::VARCHAR(255),
        vs.country::VARCHAR(255),
        vs.continent::VARCHAR(255),
        vs.total_videos::BIGINT,
        vs.total_pedestrians::BIGINT,
        vs.avg_risky_crossing_ratio::DECIMAL,
        vs.avg_run_red_light_ratio::DECIMAL,
        vs.avg_crosswalk_usage_ratio::DECIMAL,
        vs.risk_intensity::DECIMAL,
        mv.crossing_speed_rank::BIGINT
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
        -- Both filters MUST be relation-qualified: `city` is also a RETURNS TABLE output
        -- column, which PL/pgSQL puts in scope as a variable for the whole function body,
        -- so a bare `city` here raises 42702 ("column reference is ambiguous") and the
        -- function throws on every call. See scripts/migrate-fix-compare-ambiguous-city.sql.
        SELECT * FROM v_city_summary
        WHERE (city_name_param IS NULL OR v_city_summary.city = city_name_param)
    ),
    historical_data AS (
        SELECT * FROM v_city_summary_at_date(target_date) AS d
        WHERE (city_name_param IS NULL OR d.city = city_name_param)
    )
    -- Every projected column is cast to its declared RETURNS TABLE type on purpose:
    -- v_city_summary.risky_crossing_rate is `double precision` while the same column from
    -- v_city_summary_at_date() is `numeric`, and without the cast PL/pgSQL raises 42804
    -- ("structure of query does not match function result type").
    SELECT
        COALESCE(c.city, h.city)::VARCHAR                              as city,
        COALESCE(c.country, h.country)::VARCHAR                        as country,
        c.total_videos::BIGINT                                         as current_total_videos,
        c.avg_risky_crossing_ratio::DECIMAL                            as current_avg_risky_crossing,
        c.avg_crossing_speed::DECIMAL                                  as current_avg_crossing_speed,
        c.risky_crossing_rate::DECIMAL                                 as current_risky_crossing_rate,
        h.total_videos::BIGINT                                         as historical_total_videos,
        h.avg_risky_crossing_ratio::DECIMAL                            as historical_avg_risky_crossing,
        h.avg_crossing_speed::DECIMAL                                  as historical_avg_crossing_speed,
        h.risky_crossing_rate::DECIMAL                                 as historical_risky_crossing_rate,
        (c.total_videos - COALESCE(h.total_videos, 0))::BIGINT         as video_count_change,
        (c.avg_risky_crossing_ratio - COALESCE(h.avg_risky_crossing_ratio, 0))::DECIMAL as risky_crossing_change,
        (c.avg_crossing_speed - COALESCE(h.avg_crossing_speed, 0))::DECIMAL             as crossing_speed_change,
        (CURRENT_DATE - target_date)::INTEGER                          as change_period_days
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
