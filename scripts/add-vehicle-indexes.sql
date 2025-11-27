-- Add indexes on vehicle columns for faster filtering
-- These indexes will speed up the CTE query that counts vehicles per city

CREATE INDEX IF NOT EXISTS idx_pedestrians_car ON pedestrians(car) WHERE car IS TRUE;
CREATE INDEX IF NOT EXISTS idx_pedestrians_bus ON pedestrians(bus) WHERE bus IS TRUE;
CREATE INDEX IF NOT EXISTS idx_pedestrians_truck ON pedestrians(truck) WHERE truck IS TRUE;
CREATE INDEX IF NOT EXISTS idx_pedestrians_motorbike ON pedestrians(motorbike) WHERE motorbike IS TRUE;
CREATE INDEX IF NOT EXISTS idx_pedestrians_bicycle ON pedestrians(bicycle) WHERE bicycle IS TRUE;

-- Composite index for video_id + vehicle columns (helps with the JOIN and COUNT)
CREATE INDEX IF NOT EXISTS idx_pedestrians_video_vehicles ON pedestrians(video_id, car, bus, truck, motorbike, bicycle);

-- Analyze tables to update statistics
ANALYZE pedestrians;
ANALYZE videos;
ANALYZE cities;

