-- ===============================================
-- MIGRATION: per-metric sample-size columns for the globe's confidence gate
-- ===============================================
-- Every paintable measured metric gets the column that is the ACTUAL denominator of the
-- number the globe paints, so thin-sample cities can be shown without being ranked.
--
-- Why this exists: avg_measured_crossing_speed paints Milan at 4.19 m/s (~15 km/h, i.e.
-- sprinting) off n=3, while the 11 credible cities sit at 1.17-1.52. Because the colour
-- ramp is Math.min/max over all values, that one city compresses every other city into the
-- bottom third of the scale. The same failure is far larger on the four rate layers:
-- 302 of 470 painted cities rest on 1-9 pedestrians, and nine paint exactly 1.000 off a
-- SINGLE pedestrian.
--
-- Deliberate NON-additions, with the measurement that decided each:
--   * NO measured_crossing_ped_sample. count(pedestrians.crossing_speed_mps) is a DIFFERENT
--     population from videos.measured_crossing_speed_n: Milan has 57 pedestrian rows
--     (median 1.197 m/s) but the painted per-video median 4.188 rests on n=3 reliable
--     crossers. Gating on 57 would pass the exact value this work exists to stop.
--   * NO risky/red-light/crosswalk/phone *_sample columns. total_pedestrians is already
--     count(p.id), the exact denominator of those four rates (8281 of 8281 non-NULL).
--
-- Four EXISTING expressions change; all keep their name, position and type, and all are
-- verified no-ops on current data (every contributing city has exactly one video today):
--   measured_crossing_sample / cadence_sample gain the FILTER that
--     cities/[city]/details/route.ts already applies.
--   avg_measured_crossing_speed / avg_cadence_hz become n-weighted, matching that same
--     route, so the globe and the city panel can no longer disagree.
--
-- Idempotent: CREATE OR REPLACE for the view; the matview is dropped and rebuilt because
-- it was created as SELECT * (the * was expanded to 47 columns at creation, so it cannot
-- see appended columns otherwise). Verified 2026-07-27 via pg_depend that NOTHING depends
-- on mv_city_summary, and all four of its indexes are recreated below -- including the
-- UNIQUE index on id, without which refresh_materialized_views()'s
-- REFRESH ... CONCURRENTLY would start failing.

SET lock_timeout = '5s';

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
            -- CHANGED: n-weighted so a 3-crosser video cannot outvote an 86-crosser one.
            sum(videos.measured_crossing_speed_mps * videos.measured_crossing_speed_n)
              / NULLIF(sum(videos.measured_crossing_speed_n)
                       FILTER (WHERE videos.measured_crossing_speed_mps IS NOT NULL), 0)
                AS avg_measured_crossing_speed,
            -- CHANGED: FILTER added so the sample counts only videos that produced a value.
            sum(videos.measured_crossing_speed_n)
              FILTER (WHERE videos.measured_crossing_speed_mps IS NOT NULL)
                AS measured_crossing_sample,
            avg(videos.look_before_cross_frac) AS avg_look_before_cross,
            avg(videos.looked_both_ways_frac) AS avg_looked_both_ways,
            -- CHANGED: n-weighted (as above).
            sum(videos.median_cadence_hz * videos.cadence_n)
              / NULLIF(sum(videos.cadence_n)
                       FILTER (WHERE videos.median_cadence_hz IS NOT NULL), 0) AS avg_cadence_hz,
            -- CHANGED: FILTER added (as above).
            sum(videos.cadence_n) FILTER (WHERE videos.median_cadence_hz IS NOT NULL)
                AS cadence_sample,
            sum(videos.pet_severe_conflicts) AS total_severe_conflicts,
            sum(videos.pet_queued_interactions) AS total_queued_interactions,
            avg(videos.hesitation_rate) AS avg_hesitation_rate,
            avg(videos.vehicle_median_speed_mps) AS avg_vehicle_speed,
            avg(videos.mean_headway_s) AS avg_headway_s,
            sum(videos.n_social_groups) AS total_social_groups,
            -- ---- NEW (vid) ----
            count(videos.measured_crossing_speed_mps)                       AS measured_crossing_video_count,
            sum(videos.total_crossed_pedestrians)
              FILTER (WHERE videos.look_before_cross_frac IS NOT NULL)      AS look_before_cross_sample,
            count(videos.look_before_cross_frac)                            AS look_before_cross_video_count,
            sum(videos.total_vehicles)
              FILTER (WHERE videos.vehicle_median_speed_mps IS NOT NULL)    AS vehicle_speed_sample,
            count(videos.vehicle_median_speed_mps)                          AS vehicle_speed_video_count,
            sum(videos.total_pedestrians)
              FILTER (WHERE videos.pet_severe_conflicts IS NOT NULL)        AS pet_exposure_pedestrians,
            count(videos.pet_severe_conflicts)                              AS pet_video_count,
            -- PET conflicts as a RATE: the raw sum is an exposure map, not a danger map.
            -- Manila's 647 conflicts come from a 3438-pedestrian video; Cincinnati's 2 from
            -- a 16-pedestrian one. A minimum-n gate cannot fix that -- the sample is large
            -- precisely when the value is large, so gate and bias point the same way.
            (100::double precision * sum(videos.pet_severe_conflicts)::double precision)
              / NULLIF(sum(videos.total_pedestrians)
                       FILTER (WHERE videos.pet_severe_conflicts IS NOT NULL), 0)::double precision
                                                                            AS severe_conflicts_per_100_ped,
            -- social + hesitation are the ONLY two insight metrics with legacy_1hz rows.
            -- The legacy tracker fragments and under-counts, so both are aggregated
            -- dense_v2-only; legacy-only cities become NULL (absent), which is the honest
            -- state: not "thin", but "not measured on this pipeline".
            sum(videos.total_pedestrians) FILTER (
              WHERE videos.n_social_groups IS NOT NULL
                AND videos.pipeline_version = 'dense_v2')                   AS social_dense_pedestrians,
            count(*) FILTER (
              WHERE videos.n_social_groups IS NOT NULL
                AND videos.pipeline_version = 'dense_v2')                   AS social_dense_video_count,
            sum(videos.grouped_pedestrians)
              FILTER (WHERE videos.pipeline_version = 'dense_v2')           AS grouped_pedestrians_dense,
            sum(videos.grouped_pedestrians)
              FILTER (WHERE videos.pipeline_version = 'dense_v2')::double precision
              / NULLIF(sum(videos.total_pedestrians) FILTER (
                  WHERE videos.n_social_groups IS NOT NULL
                    AND videos.pipeline_version = 'dense_v2'), 0)::double precision
                                                                            AS grouped_pedestrian_share_dense,
            avg(videos.hesitation_rate)
              FILTER (WHERE videos.pipeline_version = 'dense_v2')           AS avg_hesitation_rate_dense,
            sum(videos.total_pedestrians) FILTER (
              WHERE videos.hesitation_rate IS NOT NULL
                AND videos.pipeline_version = 'dense_v2')                   AS hesitation_dense_pedestrians,
            count(*) FILTER (
              WHERE videos.hesitation_rate IS NOT NULL
                AND videos.pipeline_version = 'dense_v2')                   AS hesitation_dense_video_count,
            count(videos.avg_road_width)                                    AS road_width_video_count,
            -- view-only, so the four currently-unpainted metrics cannot ship ungated later
            sum(videos.total_vehicles)
              FILTER (WHERE videos.mean_headway_s IS NOT NULL)              AS headway_vehicle_sample,
            count(videos.mean_headway_s)                                    AS headway_video_count,
            sum(videos.total_crossed_pedestrians)
              FILTER (WHERE videos.looked_both_ways_frac IS NOT NULL)       AS looked_both_ways_sample,
            sum(videos.total_pedestrians)
              FILTER (WHERE videos.pet_queued_interactions IS NOT NULL)     AS queued_exposure_pedestrians,
            count(*) FILTER (WHERE videos.pipeline_version = 'dense_v2')    AS dense_video_count,
            count(*) FILTER (WHERE videos.pipeline_version = 'legacy_1hz')  AS legacy_video_count
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
            -- ---- NEW (ped) ----
            count(p.age)                AS age_sample,
            count(p.walking_speed_mps)  AS measured_walking_ped_sample
           FROM pedestrians p
             JOIN videos v ON v.id = p.video_id
          GROUP BY v.city_id
        )
 SELECT c.id, c.city, c.country, c.continent, c.latitude, c.longitude,
    c.population_city, c.traffic_mortality, c.literacy_rate, c.gini, c.insights,
    COALESCE(vid.total_videos, 0::bigint) AS total_videos,
    COALESCE(ped.total_pedestrians, 0::bigint) AS total_pedestrians,
    vid.avg_video_duration, vid.avg_pedestrians_per_video,
    vid.avg_risky_crossing_ratio, vid.avg_run_red_light_ratio, vid.avg_crosswalk_usage_ratio,
    ped.avg_pedestrian_age, vid.avg_crossing_speed, vid.avg_crossing_time,
    vid.avg_phone_usage_ratio, vid.avg_road_width,
    ped.risky_crossing_rate, ped.run_red_light_rate, ped.crosswalk_usage_rate, ped.phone_usage_rate,
    COALESCE(((vid.avg_risky_crossing_ratio + vid.avg_run_red_light_ratio) / 2::numeric)::double precision, ped.risky_crossing_rate) AS risk_intensity,
    vid.earliest_data_date, vid.latest_data_date, vid.earliest_import_date, vid.latest_update_date,
    vid.import_batch_count,
    vid.avg_measured_walking_speed,
    COALESCE(vid.measured_speed_video_count, 0::bigint) AS measured_speed_video_count,
    vid.avg_measured_crossing_speed, vid.measured_crossing_sample,
    vid.avg_look_before_cross, vid.avg_looked_both_ways,
    vid.avg_cadence_hz, vid.cadence_sample,
    vid.total_severe_conflicts, vid.total_queued_interactions,
    vid.avg_hesitation_rate, vid.avg_vehicle_speed, vid.avg_headway_s, vid.total_social_groups,
    -- ==== APPENDED, positions 48+ (order is load-bearing for CREATE OR REPLACE VIEW) ====
    ped.age_sample,                             -- 48
    ped.measured_walking_ped_sample,            -- 49
    vid.measured_crossing_video_count,          -- 50
    vid.look_before_cross_sample,               -- 51
    vid.look_before_cross_video_count,          -- 52
    vid.vehicle_speed_sample,                   -- 53
    vid.vehicle_speed_video_count,              -- 54
    vid.pet_exposure_pedestrians,               -- 55
    vid.pet_video_count,                        -- 56
    vid.severe_conflicts_per_100_ped,           -- 57
    vid.social_dense_pedestrians,               -- 58
    vid.social_dense_video_count,               -- 59
    vid.grouped_pedestrians_dense,              -- 60
    vid.grouped_pedestrian_share_dense,         -- 61
    vid.avg_hesitation_rate_dense,              -- 62
    vid.hesitation_dense_pedestrians,           -- 63
    vid.hesitation_dense_video_count,           -- 64
    vid.road_width_video_count,                 -- 65
    vid.headway_vehicle_sample,                 -- 66
    vid.headway_video_count,                    -- 67
    vid.looked_both_ways_sample,                -- 68
    vid.queued_exposure_pedestrians,            -- 69
    vid.dense_video_count,                      -- 70
    vid.legacy_video_count                      -- 71
   FROM cities c
     LEFT JOIN vid ON vid.city_id = c.id
     LEFT JOIN ped ON ped.city_id = c.id;

-- mv_city_summary was created as SELECT *, so its column list was frozen at 47 at creation
-- time; it must be rebuilt to see the appended columns.
DROP MATERIALIZED VIEW IF EXISTS mv_city_summary CASCADE;
CREATE MATERIALIZED VIEW mv_city_summary AS SELECT * FROM v_city_summary;

-- The UNIQUE index is required by refresh_materialized_views()'s REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX idx_mv_city_summary_id        ON public.mv_city_summary USING btree (id);
CREATE INDEX        idx_mv_city_summary_city      ON public.mv_city_summary USING btree (city);
CREATE INDEX        idx_mv_city_summary_continent ON public.mv_city_summary USING btree (continent);
CREATE INDEX        idx_mv_city_summary_coords    ON public.mv_city_summary USING btree (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

ANALYZE mv_city_summary;
