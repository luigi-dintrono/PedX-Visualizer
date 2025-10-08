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

export interface CityGlobeData {
  id: number;
  city: string;
  country: string;
  continent: string;
  latitude: number | string;
  longitude: number | string;
  population: number | string | null;
  videos_analyzed: number | string | null;
  total_videos: number | string | null;
  total_pedestrians: number | string | null;
  risky_crossing_rate: number | string | null;
  run_red_light_rate: number | string | null;
  crosswalk_usage_rate: number | string | null;
  avg_pedestrian_age: number | string | null;
  traffic_mortality: number | string | null;
  literacy_rate: number | string | null;
  gini: number | string | null;
  insights?: CityInsight[];
}
