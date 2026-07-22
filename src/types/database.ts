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
  population: number | string | null;
  total_videos: number | string | null;
  total_pedestrians: number | string | null;
  risky_crossing_rate: number | string | null;
  run_red_light_rate: number | string | null;
  crosswalk_usage_rate: number | string | null;
  phone_usage_rate: number | string | null;
  avg_pedestrian_age: number | string | null;
  avg_pedestrians_per_video: number | string | null;
  avg_crossing_speed: number | string | null;
  // MEASURED walking speed (m/s) from PedX-Insight dense tracking — unlike
  // avg_crossing_speed, which is an imported city-level constant. Sparse: NULL
  // for cities without dense-tracked videos (UI must show "no data", not 0).
  avg_measured_walking_speed: number | string | null;
  avg_crossing_time: number | string | null;
  avg_road_width: number | string | null;
  traffic_mortality: number | string | null;
  // /api/cities only:
  videos_analyzed?: number | string | null;
  measured_speed_video_count?: number | string | null;
  avg_phone_usage_ratio?: number | string | null;
  literacy_rate?: number | string | null;
  gini?: number | string | null;
  insights?: CityInsight[];
}
