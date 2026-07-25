-- ============================================================================
-- migrate-add-pedestrian-speed.sql
--
-- Idempotent. Safe to run repeatedly and on a database that already has the
-- columns. Run BEFORE `node scripts/aggregate-csv-data.js`, which now inserts
-- these four columns for every pedestrian row.
--
-- Covers two audit findings, both on the `pedestrians` table:
--
--   (b) Per-pedestrian [S1] speed metrics (walking_speed_mps, crossing_speed_mps,
--       decision_delay_s) are produced by PedX-Insight and DO reach
--       summary_data/all_pedestrian_info.csv, but had no destination columns, so
--       they were dropped at the DB boundary. Only the per-VIDEO aggregate
--       (videos.measured_walking_speed_mps, added by migrate-add-measured-speed.sql)
--       survived, which made per-pedestrian distributions impossible to query.
--
--   (c) The vehicle-class flag "human hauler" was stranded. The importer mapped the
--       two legacy columns 'human' and 'hauler' — an old split of that single class
--       name — which are empty in every CSV (0 of 1119 rows populated), so
--       pedestrians.human/.hauler always received NULL. The real CSV column
--       "human hauler" (populated for 1119/1119 rows) had no destination column.
--       The legacy columns are deliberately LEFT IN PLACE and still mapped, so
--       nothing that reads them breaks.
-- ============================================================================

-- --- (b) per-pedestrian [S1] speed metrics -----------------------------------
ALTER TABLE pedestrians ADD COLUMN IF NOT EXISTS walking_speed_mps  NUMERIC;
ALTER TABLE pedestrians ADD COLUMN IF NOT EXISTS crossing_speed_mps NUMERIC;
ALTER TABLE pedestrians ADD COLUMN IF NOT EXISTS decision_delay_s   NUMERIC;

COMMENT ON COLUMN pedestrians.walking_speed_mps IS
  'Measured walking speed (m/s) of this pedestrian track from PedX-Insight [S1] dense foot-point trajectories; NULL when no reliable trajectory exists (not fabricated).';
COMMENT ON COLUMN pedestrians.crossing_speed_mps IS
  'Measured speed (m/s) over the crossing segment of this track from PedX-Insight [S1]; NULL for non-crossers or unreliable tracks. Distinct from videos.crossing_speed, which is a city-level constant joined from an external dataset.';
COMMENT ON COLUMN pedestrians.decision_delay_s IS
  'Measured seconds between this pedestrian becoming stationary at the kerb and the start of the crossing, from PedX-Insight [S1]; NULL when the wait could not be measured.';

-- --- (c) real "human hauler" vehicle class ------------------------------------
ALTER TABLE pedestrians ADD COLUMN IF NOT EXISTS human_hauler BOOLEAN;

COMMENT ON COLUMN pedestrians.human_hauler IS
  'Presence of a "human hauler" vehicle in this pedestrian''s context, from the CSV column "human hauler". Supersedes the always-NULL legacy columns pedestrians.human and pedestrians.hauler, which are retained unchanged for backward compatibility.';

-- --- Optional read-path indexes ----------------------------------------------
-- Partial indexes: the vast majority of usable queries filter on NOT NULL, and
-- skipping NULLs keeps these small on rows imported before the speed module ran.
CREATE INDEX IF NOT EXISTS idx_pedestrians_walking_speed
    ON pedestrians (walking_speed_mps) WHERE walking_speed_mps IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedestrians_crossing_speed
    ON pedestrians (crossing_speed_mps) WHERE crossing_speed_mps IS NOT NULL;
