-- Up Migration
--
-- Which analysis code produced a video's metrics. pipeline_version cannot answer that: it is
-- set by a file-existence test ("dense_v2" if [B2]dense_tracks.csv exists), so the 24 videos
-- analysed before the 2026-07-25 rewrite of speed_estimation.py / video_info.py still read
-- "dense_v2" next to videos analysed after it. PedX-Insight now stamps each analysis run
-- (git sha + weights digest + config digest) and exports it as all_video_info.csv
-- `code_version`. NULL = unstamped, i.e. analysed before the stamp existed -- not comparable
-- to any stamped value. Metrics should only be pooled within one code_version.

ALTER TABLE videos ADD COLUMN IF NOT EXISTS code_version VARCHAR(96);
COMMENT ON COLUMN videos.code_version IS
  'PedX-Insight analysis stamp (git sha + weights + config digests) of the run that produced this row. NULL = unstamped (pre-stamp run).';
CREATE INDEX IF NOT EXISTS idx_videos_code_version ON videos (code_version);

-- Down Migration

DROP INDEX IF EXISTS idx_videos_code_version;
ALTER TABLE videos DROP COLUMN IF EXISTS code_version;
