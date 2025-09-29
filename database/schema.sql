-- Main table for global pedestrian crossing data
CREATE TABLE IF NOT EXISTS CoreGlobalCrossingData (
    id SERIAL PRIMARY KEY,
    city VARCHAR(255) NOT NULL,
    country VARCHAR(255) NOT NULL,
    population INTEGER,
    description TEXT,
    videos_analyzed INTEGER DEFAULT 0,
    crossing_speed_avg DECIMAL(5,2), -- meters per second
    crossing_speed_median DECIMAL(5,2),
    crossing_speed_min DECIMAL(5,2),
    crossing_speed_max DECIMAL(5,2),
    time_to_start_crossing_avg DECIMAL(5,2), -- seconds
    time_to_start_crossing_median DECIMAL(5,2),
    time_to_start_crossing_min DECIMAL(5,2),
    time_to_start_crossing_max DECIMAL(5,2),
    -- Additional metrics (easily extensible)
    waiting_time_avg DECIMAL(5,2), -- seconds
    waiting_time_median DECIMAL(5,2),
    crossing_distance_avg DECIMAL(5,2), -- meters
    crossing_distance_median DECIMAL(5,2),
    -- Geographic data
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_source VARCHAR(255),
    notes TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_city ON CoreGlobalCrossingData(city);
CREATE INDEX IF NOT EXISTS idx_country ON CoreGlobalCrossingData(country);
CREATE INDEX IF NOT EXISTS idx_crossing_speed ON CoreGlobalCrossingData(crossing_speed_avg);
CREATE INDEX IF NOT EXISTS idx_time_to_start ON CoreGlobalCrossingData(time_to_start_crossing_avg);
CREATE INDEX IF NOT EXISTS idx_geographic ON CoreGlobalCrossingData(latitude, longitude);

-- City-specific insights view (easily extensible for new metrics)
CREATE OR REPLACE VIEW CityInsight AS
SELECT 
    id,
    city,
    country,
    population,
    videos_analyzed,
    crossing_speed_avg,
    time_to_start_crossing_avg,
    -- Rankings for existing metrics
    RANK() OVER (ORDER BY crossing_speed_avg DESC NULLS LAST) as crossing_speed_rank,
    RANK() OVER (ORDER BY time_to_start_crossing_avg ASC NULLS LAST) as quickest_to_start_rank,
    -- Percentiles for existing metrics
    PERCENT_RANK() OVER (ORDER BY crossing_speed_avg) as crossing_speed_percentile,
    PERCENT_RANK() OVER (ORDER BY time_to_start_crossing_avg) as time_to_start_percentile,
    -- Insights for existing metrics
    CASE 
        WHEN crossing_speed_avg > (SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY crossing_speed_avg) FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL) 
        THEN 'Top 20% fastest crossing speeds'
        WHEN crossing_speed_avg < (SELECT PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY crossing_speed_avg) FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL)
        THEN 'Bottom 20% slowest crossing speeds'
        ELSE 'Average crossing speeds'
    END as crossing_speed_insight,
    CASE 
        WHEN time_to_start_crossing_avg < (SELECT PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY time_to_start_crossing_avg) FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL)
        THEN 'Quickest to start crossing (top 20%)'
        WHEN time_to_start_crossing_avg > (SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY time_to_start_crossing_avg) FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL)
        THEN 'Slowest to start crossing (bottom 20%)'
        ELSE 'Average time to start crossing'
    END as time_to_start_insight
FROM CoreGlobalCrossingData;

-- Crossing Speed Metric Insights (updated structure)
CREATE OR REPLACE VIEW MetricInsight_CrossingSpeed AS
SELECT 
    1 as id,
    'crossing_speed' as metric_type,
    'Average pedestrian crossing speed measured in meters per second' as description,
    (SELECT city FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL ORDER BY crossing_speed_avg DESC LIMIT 1) as top_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL ORDER BY crossing_speed_avg DESC LIMIT 1) as top_city_country,
    (SELECT crossing_speed_avg FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL ORDER BY crossing_speed_avg DESC LIMIT 1) as top_city_value,
    (SELECT city FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL ORDER BY crossing_speed_avg ASC LIMIT 1) as last_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL ORDER BY crossing_speed_avg ASC LIMIT 1) as last_city_country,
    (SELECT crossing_speed_avg FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL ORDER BY crossing_speed_avg ASC LIMIT 1) as last_city_value,
    (SELECT ROUND(AVG(crossing_speed_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL) as global_avg,
    (SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY crossing_speed_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE crossing_speed_avg IS NOT NULL) as global_median,
    '🏃‍♂️ Crossing speeds vary significantly across cities, reflecting different urban cultures and infrastructure designs' as insight;

-- Time to Start Crossing Metric Insights (updated structure)
CREATE OR REPLACE VIEW MetricInsight_TimeToStart AS
SELECT 
    2 as id,
    'time_to_start' as metric_type,
    'Average time pedestrians wait before starting to cross the street' as description,
    (SELECT city FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL ORDER BY time_to_start_crossing_avg ASC LIMIT 1) as top_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL ORDER BY time_to_start_crossing_avg ASC LIMIT 1) as top_city_country,
    (SELECT time_to_start_crossing_avg FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL ORDER BY time_to_start_crossing_avg ASC LIMIT 1) as top_city_value,
    (SELECT city FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL ORDER BY time_to_start_crossing_avg DESC LIMIT 1) as last_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL ORDER BY time_to_start_crossing_avg DESC LIMIT 1) as last_city_country,
    (SELECT time_to_start_crossing_avg FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL ORDER BY time_to_start_crossing_avg DESC LIMIT 1) as last_city_value,
    (SELECT ROUND(AVG(time_to_start_crossing_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL) as global_avg,
    (SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_start_crossing_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE time_to_start_crossing_avg IS NOT NULL) as global_median,
    '⚡ Decision-making speed at crossings reveals cultural attitudes toward risk and efficiency in urban environments' as insight;

-- Waiting Time Metric Insights (updated structure)
CREATE OR REPLACE VIEW MetricInsight_WaitingTime AS
SELECT 
    3 as id,
    'waiting_time' as metric_type,
    'Average time pedestrians spend waiting at crosswalks before crossing' as description,
    (SELECT city FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL ORDER BY waiting_time_avg ASC LIMIT 1) as top_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL ORDER BY waiting_time_avg ASC LIMIT 1) as top_city_country,
    (SELECT waiting_time_avg FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL ORDER BY waiting_time_avg ASC LIMIT 1) as top_city_value,
    (SELECT city FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL ORDER BY waiting_time_avg DESC LIMIT 1) as last_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL ORDER BY waiting_time_avg DESC LIMIT 1) as last_city_country,
    (SELECT waiting_time_avg FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL ORDER BY waiting_time_avg DESC LIMIT 1) as last_city_value,
    (SELECT ROUND(AVG(waiting_time_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL) as global_avg,
    (SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY waiting_time_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE waiting_time_avg IS NOT NULL) as global_median,
    '⏰ Patience levels at crosswalks reflect urban infrastructure quality and pedestrian priority in city planning' as insight;

-- Crossing Distance Metric Insights (updated structure)
CREATE OR REPLACE VIEW MetricInsight_CrossingDistance AS
SELECT 
    4 as id,
    'crossing_distance' as metric_type,
    'Average distance pedestrians need to cross streets' as description,
    (SELECT city FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL ORDER BY crossing_distance_avg DESC LIMIT 1) as top_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL ORDER BY crossing_distance_avg DESC LIMIT 1) as top_city_country,
    (SELECT crossing_distance_avg FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL ORDER BY crossing_distance_avg DESC LIMIT 1) as top_city_value,
    (SELECT city FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL ORDER BY crossing_distance_avg ASC LIMIT 1) as last_city,
    (SELECT country FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL ORDER BY crossing_distance_avg ASC LIMIT 1) as last_city_country,
    (SELECT crossing_distance_avg FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL ORDER BY crossing_distance_avg ASC LIMIT 1) as last_city_value,
    (SELECT ROUND(AVG(crossing_distance_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL) as global_avg,
    (SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY crossing_distance_avg)::numeric, 2) FROM CoreGlobalCrossingData WHERE crossing_distance_avg IS NOT NULL) as global_median,
    '📏 Street widths vary dramatically across cities, impacting pedestrian accessibility and crossing safety' as insight;

-- Combined view for all metric insights (for easy querying)
CREATE OR REPLACE VIEW MetricInsight AS
SELECT * FROM MetricInsight_CrossingSpeed
UNION ALL
SELECT * FROM MetricInsight_TimeToStart
UNION ALL
SELECT * FROM MetricInsight_WaitingTime
UNION ALL
SELECT * FROM MetricInsight_CrossingDistance;
