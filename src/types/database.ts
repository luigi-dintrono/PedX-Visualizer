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
  id: number;
  city: string;
  country: string;
  population: number | null;
  videos_analyzed: number;
  crossing_speed_avg: number | null;
  time_to_start_crossing_avg: number | null;
  crossing_speed_rank: number;
  quickest_to_start_rank: number;
  crossing_speed_percentile: number;
  time_to_start_percentile: number;
  crossing_speed_insight: string;
  time_to_start_insight: string;
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
