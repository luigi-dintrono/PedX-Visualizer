export interface CoreGlobalCrossingData {
  id: number;
  city: string;
  country: string;
  population: number | null;
  description: string | null;
  videos_analyzed: number;
  crossing_speed_avg: number | null;
  crossing_speed_median: number | null;
  crossing_speed_min: number | null;
  crossing_speed_max: number | null;
  time_to_start_crossing_avg: number | null;
  time_to_start_crossing_median: number | null;
  time_to_start_crossing_min: number | null;
  time_to_start_crossing_max: number | null;
  waiting_time_avg: number | null;
  waiting_time_median: number | null;
  crossing_distance_avg: number | null;
  crossing_distance_median: number | null;
  latitude: number | null;
  longitude: number | null;
  created_at: Date;
  updated_at: Date;
  data_source: string | null;
  notes: string | null;
}

export interface CityInsight {
  id: string;
  category: 'speed' | 'rank' | 'demographic' | 'weather' | 'vehicle' | 'behavior' | 'meta';
  text: string;
  relevance_score: number;
  data_confidence: 'high' | 'medium' | 'low';
  metrics: {
    city_value: number;
    comparison_value: number;
    delta_percent: number;
  };
}

// Per-city rollup of the PedX-Insight measured modules, served by
// /api/cities/[city]/details. A null group means the module never ran for this city's
// videos — it is NOT the same as a measured zero, and the UI must not render it as one.
export interface MeasuredBehavior {
  // How many of the city's videos came from each analysis pipeline. total_pedestrians is
  // not comparable across these: legacy_1hz fragmented and under-counted tracks, dense_v2
  // counts every tracked pedestrian. `unversioned` are rows imported before the column
  // existed and should be treated as legacy.
  pipeline: { dense_v2: number; legacy_1hz: number; unversioned: number };
  // `analysed` = rows present in the pedestrians table (the denominator behind every rate
  // metric in this app). `tracked` = the count the pipeline actually reported. Under
  // dense_v2 these differ by roughly an order of magnitude.
  pedestrian_counts: { analysed: number; tracked: number | null };
  crossing_speed: { mps: number | null; n: number | null } | null;
  vehicle_speed: { median_mps: number | null; p85_mps: number | null; videos: number } | null;
  flow: {
    mean_headway_s: number | null;
    platoon_frac: number | null;
    vehicles_per_min: number | null;
    videos: number;
  } | null;
  conflicts: {
    severe: number | null;
    moderate: number | null;
    queued: number | null;
    min_pet_s: number | null;
    videos: number;
  } | null;
  signal: {
    anticipatory_start_frac: number | null;
    mean_red_exposure_s: number | null;
    videos: number;
  } | null;
  micro_events: {
    hesitation_rate: number | null;
    aborted_start_rate: number | null;
    evasive_events: number | null;
    videos: number;
  } | null;
  social: { groups: number | null; grouped_pedestrians: number | null; videos: number } | null;
  pose: {
    look_before_cross_frac: number | null;
    looked_both_ways_frac: number | null;
    median_cadence_hz: number | null;
    cadence_n: number | null;
    videos: number;
  } | null;
  // Medians over a plausibility-filtered population; `implausible_n` is how many tracks
  // were excluded for reporting physically impossible speeds.
  pedestrian_kinematics: {
    walking_speed_mps: number | null;
    crossing_speed_mps: number | null;
    decision_delay_s: number | null;
    n: number | null;
    implausible_n: number;
  } | null;
}

export interface MetricInsight {
  id: number;
  metric_type: string;
  description: string;
  top_city: string;
  top_city_country: string;
  top_city_value: number;
  last_city: string;
  last_city_country: string;
  last_city_value: number;
  global_avg: number;
  global_median: number;
  insight: string;
}

// One ranked candidate location from monocular-OSM localization.
export interface LocalizationCandidate {
  rank: number;
  latitude: number;
  longitude: number;
  street_names: string[];
  support: number;
  google_maps_url: string;
}

// A row from /api/cities/[city]/videos — shared by Globe (markers) and InfoSidebar
// (video list), which consume the SAME fetch via FilterContext.cityVideos.
export interface CityVideo {
  id: number;
  video_name: string;
  link: string;
  duration_seconds: number | string | null;
  total_pedestrians: number | null;
  latitude: number | null;
  longitude: number | null;
  city_latitude: number | null;
  city_longitude: number | null;
  // Localization provenance (real coords from PedX-Insight; null when mock/fallback)
  localization_confidence: string | null;
  street_name: string | null;
  localization_status: string | null;
  localization_spread_m: number | null;
  localization_candidates: LocalizationCandidate[] | null;
  // Estimated camera route through the city as [[lat, lon], ...] in WGS84, ordered along
  // the path. These are walking-tour videos, so it is the route actually walked. null when
  // no route was recovered — distinct from an empty route.
  localization_route: [number, number][] | null;
  localization_route_length_m: number | null;
  localization_trajectory_source: string | null;
  risky_crossing_ratio: number | null;
  run_red_light_ratio: number | null;
  crosswalk_usage_ratio: number | null;
  phone_usage_ratio: number | null;
  main_weather: string | null;
  city: string;
  country: string;
}

// Rows served by BOTH /api/data (globe heatmap; trimmed column set, floats) and
// /api/cities (sidebar city data; full v_city_summary column set, DECIMALs as strings).
// Fields marked optional are only present on the /api/cities variant.
export interface CityGlobeData {
  id: number;
  city: string;
  country: string;
  continent: string;
  latitude: number | string;
  longitude: number | string;
  population?: number | string | null;
  total_videos?: number | string | null;
  total_pedestrians?: number | string | null;
  risky_crossing_rate?: number | string | null;
  run_red_light_rate?: number | string | null;
  crosswalk_usage_rate?: number | string | null;
  phone_usage_rate?: number | string | null;
  avg_pedestrian_age?: number | string | null;
  avg_pedestrians_per_video?: number | string | null;
  avg_crossing_speed?: number | string | null;
  // MEASURED walking speed (m/s) from PedX-Insight dense tracking — unlike
  // avg_crossing_speed, which is an imported city-level constant. Sparse: NULL
  // for cities without dense-tracked videos (UI must show "no data", not 0).
  avg_measured_walking_speed?: number | string | null;
  // Novel behavioural insights measured by PedX-Insight (PET conflicts, head-scanning,
  // hesitation, vehicle speed, social groups). Sparse: NULL for cities without
  // dense-tracked videos, so the UI must render "no data" rather than 0.
  avg_measured_crossing_speed?: number | string | null;
  avg_look_before_cross?: number | string | null;
  total_severe_conflicts?: number | string | null;
  avg_hesitation_rate?: number | string | null;
  avg_vehicle_speed?: number | string | null;
  total_social_groups?: number | string | null;
  measured_crossing_sample?: number | string | null;
  // Sample-size gates. METRIC_CONFIG[...].sample.property names one of these; a city whose
  // sample is below sample.minN is drawn as an unranked ring and excluded from the colour
  // ramp, so the scale is set by cities with enough evidence to rank.
  age_sample?: number | string | null;
  measured_walking_ped_sample?: number | string | null;
  look_before_cross_sample?: number | string | null;
  vehicle_speed_sample?: number | string | null;
  pet_exposure_pedestrians?: number | string | null;
  social_dense_pedestrians?: number | string | null;
  hesitation_dense_pedestrians?: number | string | null;
  // Exposure-normalised / dense-pipeline-only replacements for the raw sums above. The raw
  // totals are kept purely as hover context.
  severe_conflicts_per_100_ped?: number | string | null;
  grouped_pedestrians_dense?: number | string | null;
  grouped_pedestrian_share_dense?: number | string | null;
  avg_hesitation_rate_dense?: number | string | null;
  avg_crossing_time?: number | string | null;
  avg_road_width?: number | string | null;
  traffic_mortality?: number | string | null;
  // /api/cities only:
  videos_analyzed?: number | string | null;
  measured_speed_video_count?: number | string | null;
  avg_phone_usage_ratio?: number | string | null;
  literacy_rate?: number | string | null;
  gini?: number | string | null;
  insights?: CityInsight[];
}
