-- Migration: metric-validity columns + exposure denominator provenance
-- Applied 2026-09-07. Mirrored into database/schema.sql.
--
-- WHY
-- ---
-- 1. risky_crossing_ratio was an inverse index of environment-detector recall, not a
--    behavioural measure. modules/risky_crossing/risky_crossing.py classified a frame
--    "risky" when NEITHER the traffic-light nor the crosswalk detector fired; because
--    the light detector reports a colour in only 0-37% of samples and the crosswalk
--    detector fires on 0% of frames in 17 of 28 videos, that branch dominated. The
--    published column correlated with traffic_light_prob at Spearman -0.656 (p=0.0005,
--    n=24), median 0.915, with 9 of 24 videos at exactly 1.000.
--
--    The metric is now EVIDENCE-POSITIVE: computed only over crossings whose signal
--    state was actually observed. On a FIXED sample (the 19 videos where both the old
--    and new metric are defined) the correlation falls from -0.522 (p=0.022) to -0.152
--    (p=0.53). It is REDUCED, NOT ELIMINATED: within the comparable dense_v2 tier it is
--    still significant at -0.650 (p=0.022, n=12), so this column is not yet safe to read
--    as cross-city behaviour without detector recalibration against a labelled set.
--    risky_crossing_coverage records what share of a video's crossings were
--    determinable and MUST be used to gate the ratio -- coverage itself correlates
--    +0.580 (p=0.003) with detector recall, so a low-coverage city's ratio rests on a
--    biased subsample. unsignalled_crossing_ratio preserves the old construct under an
--    honest name (it correlates -0.891 with traffic_light_prob: the confounded part).
--
-- 2. duration_source records how the exposure denominator was obtained. duration_seconds
--    was NULL in 26 of 28 rows because the summary module reopened a video run.py had
--    already deleted; it is now coalesced from [B0]video_meta.csv / [A3]analysis_time.csv
--    (27 of 28 recovered). The upsert in scripts/aggregate-csv-data.js no longer
--    overwrites a stored duration with NULL.

ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS risky_crossing_coverage   DECIMAL(5, 4),
    ADD COLUMN IF NOT EXISTS unsignalled_crossing_ratio DECIMAL(5, 4),
    ADD COLUMN IF NOT EXISTS duration_source           VARCHAR(32);

COMMENT ON COLUMN videos.risky_crossing_ratio IS
    'Evidence-positive since 2026-09-07: share of crossings AGAINST an OBSERVED signal, '
    'over the crossings whose signal state was observed. NULL when none were. '
    'Always read with risky_crossing_coverage.';
COMMENT ON COLUMN videos.risky_crossing_coverage IS
    'Share of this video''s crossings whose signal state was observed. Gate '
    'risky_crossing_ratio on this; it correlates +0.888 with traffic_light_prob.';
COMMENT ON COLUMN videos.unsignalled_crossing_ratio IS
    'Pre-2026-09 construct: mean share of crossing frames with neither light nor '
    'crosswalk observed. An environment-characterisation descriptor dominated by '
    'detector recall (rho -0.891 vs traffic_light_prob). NOT a behavioural measure.';
COMMENT ON COLUMN videos.duration_source IS
    'Provenance of duration_seconds: video | video_meta ([B0]) | analysis_time ([A3]).';
