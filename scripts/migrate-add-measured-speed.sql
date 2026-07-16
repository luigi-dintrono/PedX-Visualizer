-- Measured (not imported) per-video median pedestrian walking speed in m/s, produced by
-- PedX-Insight's [S1] speed module from dense foot-point trajectories (reliable tracks
-- only; NULL for videos analyzed before the dense-tracking pass — refuse, don't fabricate).
-- Distinct from crossing_speed, which is a city-level constant joined from an external
-- dataset by city name.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS measured_walking_speed_mps NUMERIC;
COMMENT ON COLUMN videos.measured_walking_speed_mps IS
  'Median measured walking speed (m/s) of reliable pedestrian tracks from PedX-Insight [S1]; NULL when no dense-tracking analysis exists';
