-- ===============================================
-- MIGRATION: surface the novel-insight metrics PER CITY
-- ===============================================
-- The insight metrics (measured crossing speed, look-before-crossing, PET conflicts,
-- hesitation, cadence, vehicle speed, headways, social groups) already land per-video in
-- `videos`, but the Globe, filters and city API all read per-CITY aggregates from
-- v_city_summary / mv_city_insights. Without these columns the data is queryable but can
-- never be displayed.
--
-- Built by extending the LIVE view definitions, so every existing column keeps its name,
-- order and type; new columns are appended at the end (required by CREATE OR REPLACE VIEW).
-- Sample-size columns (measured_crossing_sample, cadence_sample) come along so the UI can
-- filter thin samples -- e.g. Milan's crossing speed rests on n=3.
--
-- Idempotent: re-running replaces the view and rebuilds the matview + its indexes.

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
            avg(videos.measured_crossing_speed_mps) AS avg_measured_crossing_speed,
            sum(videos.measured_crossing_speed_n) AS measured_crossing_sample,
            avg(videos.look_before_cross_frac) AS avg_look_before_cross,
            avg(videos.looked_both_ways_frac) AS avg_looked_both_ways,
            avg(videos.median_cadence_hz) AS avg_cadence_hz,
            sum(videos.cadence_n) AS cadence_sample,
            sum(videos.pet_severe_conflicts) AS total_severe_conflicts,
            sum(videos.pet_queued_interactions) AS total_queued_interactions,
            avg(videos.hesitation_rate) AS avg_hesitation_rate,
            avg(videos.vehicle_median_speed_mps) AS avg_vehicle_speed,
            avg(videos.mean_headway_s) AS avg_headway_s,
            sum(videos.n_social_groups) AS total_social_groups
           FROM videos
          GROUP BY videos.city_id
        ), ped AS (
         SELECT v.city_id,
            count(p.id) AS total_pedestrians,
            avg(p.age) AS avg_pedestrian_age,
            count(*) FILTER (WHERE p.risky_crossing)::double precision / NULLIF(count(p.id), 0)::double precision AS risky_crossing_rate,
            count(*) FILTER (WHERE p.run_red_light)::double precision / NULLIF(count(p.id), 0)::double precision AS run_red_light_rate,
            count(*) FILTER (WHERE p.crosswalk_use_or_not)::double precision / NULLIF(count(p.id), 0)::double precision AS crosswalk_usage_rate,
            count(*) FILTER (WHERE p.phone_using)::double precision / NULLIF(count(p.id), 0)::double precision AS phone_usage_rate
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
    vid.total_social_groups
   FROM cities c
     LEFT JOIN vid ON vid.city_id = c.id
     LEFT JOIN ped ON ped.city_id = c.id;

DROP MATERIALIZED VIEW IF EXISTS mv_city_insights CASCADE;
CREATE MATERIALIZED VIEW mv_city_insights AS
 WITH vid AS (
         SELECT videos.city_id,
            count(*) AS video_count,
            avg(videos.crossing_speed) AS avg_crossing_speed,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((videos.crossing_speed)::double precision)) AS median_crossing_speed,
            avg(videos.risky_crossing_ratio) AS avg_risky_crossing_ratio,
            avg(videos.run_red_light_ratio) AS avg_run_red_light_ratio,
            avg(videos.crosswalk_usage_ratio) AS avg_crosswalk_usage_ratio,
            avg(videos.avg_road_width) AS avg_road_width,
            avg(videos.crossing_time) AS avg_crossing_time,
            mode() WITHIN GROUP (ORDER BY videos.main_weather) AS dominant_weather,
            count(DISTINCT videos.main_weather) AS weather_variety,
            string_agg(DISTINCT videos.top3_vehicles, ', '::text) FILTER (WHERE (videos.top3_vehicles IS NOT NULL)) AS vehicles_list,
            count(*) FILTER (WHERE ((videos.localization_status)::text = 'ok'::text)) AS videos_localized,
            (array_agg(videos.street_name) FILTER (WHERE (((videos.localization_status)::text = 'ok'::text) AND (videos.street_name IS NOT NULL))))[1] AS localized_street,
            avg(videos.total_pedestrians) AS avg_pedestrians_per_video,
            avg(videos.total_vehicles) AS avg_vehicles_per_video,
            avg(videos.traffic_light_prob) AS avg_traffic_light_prob,
            avg(videos.crosswalk_prob) AS avg_crosswalk_prob,
            avg(videos.sidewalk_prob) AS avg_sidewalk_prob,
            avg(videos.accident_prob) AS avg_accident_prob,
            avg(videos.crack_prob) AS avg_crack_prob,
            avg(videos.potholes_prob) AS avg_potholes_prob,
            avg(videos.traffic_signs_ratio) AS avg_traffic_signs_ratio,
            avg(videos.measured_walking_speed_mps) AS avg_measured_walking_speed,
            avg(videos.measured_crossing_speed_mps) AS avg_measured_crossing_speed,
            sum(videos.measured_crossing_speed_n) AS measured_crossing_sample,
            avg(videos.look_before_cross_frac) AS avg_look_before_cross,
            avg(videos.looked_both_ways_frac) AS avg_looked_both_ways,
            avg(videos.median_cadence_hz) AS avg_cadence_hz,
            sum(videos.cadence_n) AS cadence_sample,
            sum(videos.pet_severe_conflicts) AS total_severe_conflicts,
            sum(videos.pet_queued_interactions) AS total_queued_interactions,
            avg(videos.hesitation_rate) AS avg_hesitation_rate,
            avg(videos.vehicle_median_speed_mps) AS avg_vehicle_speed,
            avg(videos.mean_headway_s) AS avg_headway_s,
            sum(videos.n_social_groups) AS total_social_groups,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((videos.measured_walking_speed_mps)::double precision)) AS median_measured_walking_speed,
            count(videos.measured_walking_speed_mps) AS measured_speed_video_count
           FROM videos
          GROUP BY videos.city_id
        ), ped AS (
         SELECT v.city_id,
            count(p.id) AS pedestrian_count,
            avg(p.age) AS avg_age,
            ((count(*) FILTER (WHERE ((p.gender)::text = 'male'::text)))::double precision / (NULLIF(count(p.id), 0))::double precision) AS male_ratio,
            ((count(*) FILTER (WHERE p.phone_using))::double precision / (NULLIF(count(p.id), 0))::double precision) AS phone_usage_ratio
           FROM (pedestrians p
             JOIN videos v ON ((v.id = p.video_id)))
          GROUP BY v.city_id
        ), base AS (
         SELECT c.id AS city_id,
            c.city,
            c.country,
            c.continent,
            c.med_age AS city_med_age,
            COALESCE(vid.video_count, (0)::bigint) AS video_count,
            COALESCE(ped.pedestrian_count, (0)::bigint) AS pedestrian_count,
            vid.avg_crossing_speed,
            vid.median_crossing_speed,
            vid.avg_risky_crossing_ratio,
            vid.avg_run_red_light_ratio,
            vid.avg_crosswalk_usage_ratio,
            ped.avg_age,
            ped.male_ratio,
            ped.phone_usage_ratio,
            vid.dominant_weather,
            vid.weather_variety,
            vid.vehicles_list,
            vid.avg_road_width,
            vid.avg_crossing_time,
            vid.videos_localized,
            vid.localized_street,
            vid.avg_pedestrians_per_video,
            vid.avg_vehicles_per_video,
            vid.avg_traffic_light_prob,
            vid.avg_crosswalk_prob,
            vid.avg_sidewalk_prob,
            vid.avg_accident_prob,
            vid.avg_crack_prob,
            vid.avg_potholes_prob,
            vid.avg_traffic_signs_ratio,
            vid.avg_measured_walking_speed,
            vid.median_measured_walking_speed,
            COALESCE(vid.measured_speed_video_count, (0)::bigint) AS measured_speed_video_count,
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
            vid.total_social_groups
           FROM ((cities c
             LEFT JOIN vid ON ((vid.city_id = c.id)))
             LEFT JOIN ped ON ((ped.city_id = c.id)))
        ), measured_ranked AS (
         SELECT base_1.city_id,
            rank() OVER (ORDER BY base_1.avg_measured_walking_speed DESC) AS measured_walking_speed_rank
           FROM base base_1
          WHERE (base_1.avg_measured_walking_speed IS NOT NULL)
        )
 SELECT base.city_id,
    base.city,
    base.country,
    base.continent,
    base.city_med_age,
    base.video_count,
    base.pedestrian_count,
    base.avg_crossing_speed,
    rank() OVER (ORDER BY base.avg_crossing_speed DESC NULLS LAST) AS speed_rank,
    base.median_crossing_speed,
    base.avg_risky_crossing_ratio,
    base.avg_run_red_light_ratio,
    base.avg_crosswalk_usage_ratio,
    rank() OVER (ORDER BY base.avg_risky_crossing_ratio DESC NULLS LAST) AS risky_rank,
    rank() OVER (ORDER BY base.avg_run_red_light_ratio DESC NULLS LAST) AS red_light_rank,
    rank() OVER (ORDER BY base.avg_crosswalk_usage_ratio DESC NULLS LAST) AS crosswalk_usage_rank,
    base.avg_age,
    base.male_ratio,
    base.phone_usage_ratio,
    base.dominant_weather,
    base.weather_variety,
    base.vehicles_list,
    base.avg_road_width,
    base.avg_crossing_time,
    base.videos_localized,
    base.localized_street,
    base.avg_pedestrians_per_video,
    base.avg_vehicles_per_video,
    base.avg_traffic_light_prob,
    base.avg_crosswalk_prob,
    base.avg_sidewalk_prob,
    base.avg_accident_prob,
    base.avg_crack_prob,
    base.avg_potholes_prob,
    base.avg_traffic_signs_ratio,
    rank() OVER (PARTITION BY base.continent ORDER BY base.avg_crossing_speed DESC NULLS LAST) AS continent_speed_rank,
    ( SELECT count(*) AS count
           FROM cities c2
          WHERE ((c2.continent)::text = (base.continent)::text)) AS cities_in_continent,
    base.avg_measured_walking_speed,
    base.median_measured_walking_speed,
    base.measured_speed_video_count,
    measured_ranked.measured_walking_speed_rank,
    base.avg_measured_crossing_speed,
    base.measured_crossing_sample,
    base.avg_look_before_cross,
    base.avg_looked_both_ways,
    base.avg_cadence_hz,
    base.cadence_sample,
    base.total_severe_conflicts,
    base.total_queued_interactions,
    base.avg_hesitation_rate,
    base.avg_vehicle_speed,
    base.avg_headway_s,
    base.total_social_groups
   FROM (base
     LEFT JOIN measured_ranked ON ((measured_ranked.city_id = base.city_id)));

CREATE INDEX IF NOT EXISTS idx_mv_city_insights_city ON public.mv_city_insights USING btree (city_id);
CREATE INDEX IF NOT EXISTS idx_mv_city_insights_continent ON public.mv_city_insights USING btree (continent);
