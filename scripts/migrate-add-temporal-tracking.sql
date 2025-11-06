-- ===============================================
-- MIGRATION: Add Temporal Data Tracking
-- ===============================================
-- This migration adds support for historical data tracking while maintaining
-- cumulative aggregation for general views. Temporal data is only shown when
-- explicitly requested via date parameters.
--
-- Usage: psql $DATABASE_URL -f scripts/migrate-add-temporal-tracking.sql
-- ===============================================

-- ===============================================
-- IMPORT BATCH TRACKING
-- ===============================================

CREATE TABLE IF NOT EXISTS import_batches (
    id SERIAL PRIMARY KEY,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    description TEXT,
    file_count INTEGER,
    record_count INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_batches_date ON import_batches(import_date DESC);

-- ===============================================
-- ADD TEMPORAL TRACKING TO VIDEOS
-- ===============================================

-- Add columns to track data collection and import
ALTER TABLE videos 
    ADD COLUMN IF NOT EXISTS data_collected_date DATE,
    ADD COLUMN IF NOT EXISTS import_batch_id INTEGER REFERENCES import_batches(id),
    ADD COLUMN IF NOT EXISTS first_imported_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create indexes for temporal queries
CREATE INDEX IF NOT EXISTS idx_videos_temporal ON videos(data_collected_date, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_videos_import_batch ON videos(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_videos_first_imported ON videos(first_imported_at);

-- ===============================================
-- VIDEO VERSION HISTORY (Optional - for tracking changes)
-- ===============================================

-- Table to track when videos were updated (for historical analysis)
CREATE TABLE IF NOT EXISTS video_update_history (
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

CREATE INDEX IF NOT EXISTS idx_video_history_video ON video_update_history(video_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_video_history_batch ON video_update_history(import_batch_id);

-- ===============================================
-- MIGRATE EXISTING DATA
-- ===============================================

-- Create initial import batch for existing data
DO $$
DECLARE
    initial_batch_id INTEGER;
BEGIN
    -- Create import batch for existing data
    INSERT INTO import_batches (description, import_date, record_count)
    VALUES (
        'Initial data migration - existing videos',
        CURRENT_TIMESTAMP,
        (SELECT COUNT(*) FROM videos)
    )
    RETURNING id INTO initial_batch_id;

    -- Update existing videos with default temporal values
    UPDATE videos 
    SET 
        data_collected_date = COALESCE(created_at::DATE, CURRENT_DATE),
        import_batch_id = initial_batch_id,
        first_imported_at = COALESCE(created_at, CURRENT_TIMESTAMP),
        last_updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
    WHERE import_batch_id IS NULL;

    RAISE NOTICE 'Migrated existing videos to import batch #%', initial_batch_id;
END $$;

-- ===============================================
-- TEMPORAL VIEWS AND FUNCTIONS
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
    RETURN QUERY
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
        -- Only count videos that existed up to target_date
        COUNT(DISTINCT v.id) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as total_videos,
        COUNT(DISTINCT p.id) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as total_pedestrians,
        AVG(v.duration_seconds) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_video_duration,
        AVG(v.total_pedestrians) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_pedestrians_per_video,
        AVG(v.risky_crossing_ratio) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_risky_crossing_ratio,
        AVG(v.run_red_light_ratio) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_run_red_light_ratio,
        AVG(v.crosswalk_usage_ratio) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_crosswalk_usage_ratio,
        AVG(p.age) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_pedestrian_age,
        AVG(v.crossing_speed) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        )::DECIMAL as avg_crossing_speed,
        AVG(v.crossing_time) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        )::DECIMAL as avg_crossing_time,
        AVG(v.phone_usage_ratio) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_phone_usage_ratio,
        AVG(v.avg_road_width) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        ) as avg_road_width,
        COUNT(CASE WHEN p.risky_crossing THEN 1 END) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        )::FLOAT / NULLIF(
            COUNT(p.id) FILTER (
                WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                  AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
            ), 0
        ) as risky_crossing_rate,
        COUNT(CASE WHEN p.run_red_light THEN 1 END) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        )::FLOAT / NULLIF(
            COUNT(p.id) FILTER (
                WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                  AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
            ), 0
        ) as run_red_light_rate,
        COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        )::FLOAT / NULLIF(
            COUNT(p.id) FILTER (
                WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                  AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
            ), 0
        ) as crosswalk_usage_rate,
        COUNT(CASE WHEN p.phone_using THEN 1 END) FILTER (
            WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
              AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
        )::FLOAT / NULLIF(
            COUNT(p.id) FILTER (
                WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                  AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
            ), 0
        ) as phone_usage_rate,
        COALESCE(
            (AVG(v.risky_crossing_ratio) FILTER (
                WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                  AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
            ) + AVG(v.run_red_light_ratio) FILTER (
                WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                  AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
            )) / 2,
            COUNT(CASE WHEN p.risky_crossing THEN 1 END) FILTER (
                WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                  AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
            )::FLOAT / NULLIF(
                COUNT(p.id) FILTER (
                    WHERE (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
                      AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
                ), 0
            )
        ) as risk_intensity,
        target_date as data_as_of_date
    FROM cities c
    LEFT JOIN videos v ON c.id = v.city_id
        AND (v.data_collected_date IS NULL OR v.data_collected_date <= target_date)
        AND (v.first_imported_at IS NULL OR v.first_imported_at <= target_date::TIMESTAMP)
    LEFT JOIN pedestrians p ON v.id = p.video_id
    GROUP BY c.id, c.city, c.country, c.continent, c.latitude, c.longitude, 
             c.population_city, c.traffic_mortality, c.literacy_rate, c.gini, c.insights;
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

-- ===============================================
-- UPDATE EXISTING VIEWS TO BE CUMULATIVE
-- ===============================================

-- Update v_city_summary to include temporal metadata (but aggregate all data)
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
    -- Aggregated metrics (ALL videos, cumulative)
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
    -- Calculated rates (ALL data)
    COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as risky_crossing_rate,
    COUNT(CASE WHEN p.run_red_light THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as run_red_light_rate,
    COUNT(CASE WHEN p.crosswalk_use_or_not THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as crosswalk_usage_rate,
    COUNT(CASE WHEN p.phone_using THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as phone_usage_rate,
    -- Heatmap intensity (composite score)
    COALESCE(
        (AVG(v.risky_crossing_ratio) + AVG(v.run_red_light_ratio)) / 2, 
        COUNT(CASE WHEN p.risky_crossing THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0)
    ) as risk_intensity,
    -- Temporal metadata (for reference, not filtering)
    MIN(v.data_collected_date) as earliest_data_date,
    MAX(v.data_collected_date) as latest_data_date,
    MIN(v.first_imported_at) as earliest_import_date,
    MAX(v.last_updated_at) as latest_update_date,
    COUNT(DISTINCT v.import_batch_id) as import_batch_count
FROM cities c
LEFT JOIN videos v ON c.id = v.city_id
LEFT JOIN pedestrians p ON v.id = p.video_id
GROUP BY c.id, c.city, c.country, c.continent, c.latitude, c.longitude, 
         c.population_city, c.traffic_mortality, c.literacy_rate, c.gini, c.insights;

-- ===============================================
-- HELPER FUNCTIONS
-- ===============================================

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

-- Migration completed
-- Use v_city_summary for cumulative data (default)
-- Use v_city_summary_at_date(date) for historical data
-- Use compare_city_data_current_vs_date(date, city) for comparisons

