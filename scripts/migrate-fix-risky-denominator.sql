-- Migration: exclude UNDETERMINED pedestrians from the risky-crossing denominator
-- Applied 2026-09-07.
--
-- WHY
-- ---
-- pedestrians.risky_crossing became nullable on 2026-09-07: NULL now means "the signal
-- state was never observed during this crossing", which is NOT the same as "crossed
-- safely". The city rate in v_city_summary still divided by count(p.id) -- every
-- pedestrian, determined or not -- so an undetermined crossing was counted as a safe
-- one. That is precisely the absence-as-evidence error the Python rewrite removed at
-- video level, reintroduced at pedestrian level with the sign flipped.
--
-- Measured before this fix: of 1,371 pedestrian rows in the 28 analysed videos, 871 are
-- undetermined. City rates were deflated 2-7x (Manila 0.120 published vs 0.439 over the
-- determined population; Jakarta 0.059 vs 0.387; Sydney 0.211 vs 0.727), and the three
-- cities where the light detector never fired at all -- Cincinnati, Dhaka, Las Vegas --
-- published as exactly 0.0000 and were painted at the SAFEST end of the globe's colour
-- ramp.
--
-- WHAT
-- ----
-- risky_crossing_rate now divides by the determined population only, and NULLIF makes it
-- NULL (not 0) for a city with no determined crossings. risky_crossing_determined is
-- exposed so the map and leaderboard can gate on it the way they already gate on
-- total_pedestrians -- the rate is meaningless without it.
--
-- The other three rates (run_red_light, crosswalk_usage, phone_usage) keep count(p.id):
-- those columns carry no NULLs, so their denominator is unchanged and correct.
--
-- risk_intensity needs no edit: its COALESCE falls back to ped.risky_crossing_rate, which
-- is now correctly NULL for a zero-determined city instead of a spurious 0.

DROP MATERIALIZED VIEW IF EXISTS mv_city_summary;

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
            count(*) FILTER (WHERE p.risky_crossing)::double precision / NULLIF(count(*) FILTER (WHERE p.risky_crossing IS NOT NULL), 0)::double precision AS risky_crossing_rate,
            count(*) FILTER (WHERE p.risky_crossing IS NOT NULL) AS risky_crossing_determined,
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
    vid.legacy_video_count,
    -- appended 2026-09-07: CREATE OR REPLACE VIEW can only add columns at the end
    ped.risky_crossing_determined
   FROM cities c
     LEFT JOIN vid ON vid.city_id = c.id
     LEFT JOIN ped ON ped.city_id = c.id;

CREATE MATERIALIZED VIEW mv_city_summary AS
 SELECT id,
    city,
    country,
    continent,
    latitude,
    longitude,
    population_city,
    traffic_mortality,
    literacy_rate,
    gini,
    insights,
    total_videos,
    total_pedestrians,
    avg_video_duration,
    avg_pedestrians_per_video,
    avg_risky_crossing_ratio,
    avg_run_red_light_ratio,
    avg_crosswalk_usage_ratio,
    avg_pedestrian_age,
    avg_crossing_speed,
    avg_crossing_time,
    avg_phone_usage_ratio,
    avg_road_width,
    risky_crossing_rate,
    run_red_light_rate,
    crosswalk_usage_rate,
    phone_usage_rate,
    risk_intensity,
    earliest_data_date,
    latest_data_date,
    earliest_import_date,
    latest_update_date,
    import_batch_count,
    avg_measured_walking_speed,
    measured_speed_video_count,
    avg_measured_crossing_speed,
    measured_crossing_sample,
    avg_look_before_cross,
    avg_looked_both_ways,
    avg_cadence_hz,
    cadence_sample,
    total_severe_conflicts,
    total_queued_interactions,
    avg_hesitation_rate,
    avg_vehicle_speed,
    avg_headway_s,
    total_social_groups,
    age_sample,
    measured_walking_ped_sample,
    measured_crossing_video_count,
    look_before_cross_sample,
    look_before_cross_video_count,
    vehicle_speed_sample,
    vehicle_speed_video_count,
    pet_exposure_pedestrians,
    pet_video_count,
    severe_conflicts_per_100_ped,
    social_dense_pedestrians,
    social_dense_video_count,
    grouped_pedestrians_dense,
    grouped_pedestrian_share_dense,
    avg_hesitation_rate_dense,
    hesitation_dense_pedestrians,
    hesitation_dense_video_count,
    road_width_video_count,
    headway_vehicle_sample,
    headway_video_count,
    looked_both_ways_sample,
    queued_exposure_pedestrians,
    dense_video_count,
    legacy_video_count,
    risky_crossing_determined
   FROM v_city_summary;

CREATE UNIQUE INDEX idx_mv_city_summary_id ON public.mv_city_summary USING btree (id);
CREATE INDEX idx_mv_city_summary_city ON public.mv_city_summary USING btree (city);
CREATE INDEX idx_mv_city_summary_continent ON public.mv_city_summary USING btree (continent);
CREATE INDEX idx_mv_city_summary_coords ON public.mv_city_summary USING btree (latitude, longitude) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));
