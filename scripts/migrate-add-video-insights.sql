-- ===============================================
-- MIGRATION: carry PedX-Insight's novel behavioural insights into the videos table
-- ===============================================
-- Until now the six insight modules + pose wrote rich per-video CSVs that had NO
-- aggregation path: [I1] PET conflicts, [V8] vehicle speed, [V11] headways,
-- [P10] signal timing, [P11] micro-events, [I2]/[I3] social groups, [P12] pose.
-- modules/summary/video_info.py::_insight_rollup now folds them into [A1], and
-- get_all_video_info.py carries them into summary_data/all_video_info.csv.
--
-- Also adds:
--   measured_crossing_speed_mps  - the validated headline behavioural metric (median
--                                  curb-to-curb speed of reliable crossers; 1.41 m/s
--                                  across 178 crossers, matching the 1.2-1.5 m/s
--                                  literature band). This is the like-for-like
--                                  counterpart of the imported `crossing_speed` constant.
--   measured_crossing_speed_n    - sample size behind it, so thin samples can be filtered.
--   pipeline_version             - 'dense_v2' vs 'legacy_1hz'. total_pedestrians is NOT
--                                  comparable across the two: the legacy 1 Hz tracker
--                                  fragmented and under-counted, dense_v2 counts every
--                                  tracked pedestrian. Group or filter on this column
--                                  rather than averaging the eras together.
--
-- Additive and idempotent: safe to re-run.

SET lock_timeout = '5s';

ALTER TABLE videos ADD COLUMN IF NOT EXISTS measured_crossing_speed_mps NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS measured_crossing_speed_n   INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS pipeline_version            TEXT;

-- surrogate-safety (PET) conflicts
ALTER TABLE videos ADD COLUMN IF NOT EXISTS pet_severe_conflicts    INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS pet_moderate_conflicts  INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS pet_queued_interactions INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS pet_min_s               NUMERIC;

-- vehicle kinematics and flow
ALTER TABLE videos ADD COLUMN IF NOT EXISTS vehicle_median_speed_mps NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS vehicle_p85_speed_mps    NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS mean_headway_s           NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS platoon_frac             NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS vehicle_flow_per_min     NUMERIC;

-- signal-phase behaviour
ALTER TABLE videos ADD COLUMN IF NOT EXISTS anticipatory_start_frac NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS mean_red_exposure_s     NUMERIC;

-- hesitation / micro-events
ALTER TABLE videos ADD COLUMN IF NOT EXISTS hesitation_rate     NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS aborted_start_rate  NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS evasive_event_count INTEGER;

-- social groups
ALTER TABLE videos ADD COLUMN IF NOT EXISTS n_social_groups      INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS grouped_pedestrians  INTEGER;

-- pose: looking behaviour and gait
ALTER TABLE videos ADD COLUMN IF NOT EXISTS look_before_cross_frac NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS looked_both_ways_frac  NUMERIC;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS median_cadence_hz      NUMERIC;
-- Sample size behind median_cadence_hz. Pose tracking succeeds on far fewer videos
-- than the other modules, so without this the cadence figure cannot be filtered for
-- thin samples the way measured_crossing_speed_n allows.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS cadence_n              INTEGER;

COMMENT ON COLUMN videos.measured_crossing_speed_mps IS
  'Measured median curb-to-curb crossing speed (m/s) of reliable crossers, PedX-Insight [S1]; NULL when no crossing was measurable';
COMMENT ON COLUMN videos.pipeline_version IS
  'Analysis pipeline that produced this row: dense_v2 (dense tracking, measured kinematics) or legacy_1hz. total_pedestrians is not comparable across versions.';
COMMENT ON COLUMN videos.look_before_cross_frac IS
  'Fraction of pose-tracked pedestrians who turned their head left or right before crossing ([P12])';
COMMENT ON COLUMN videos.cadence_n IS
  'Number of pose-tracked pedestrians behind median_cadence_hz; filter thin samples on this.';
