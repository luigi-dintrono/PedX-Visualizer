-- Sample data for testing
INSERT INTO CoreGlobalCrossingData (
    city, country, population, description, videos_analyzed,
    crossing_speed_avg, crossing_speed_median, crossing_speed_min, crossing_speed_max,
    time_to_start_crossing_avg, time_to_start_crossing_median, time_to_start_crossing_min, time_to_start_crossing_max,
    waiting_time_avg, waiting_time_median, crossing_distance_avg, crossing_distance_median,
    latitude, longitude, data_source, notes
) VALUES 
(
    'Tokyo', 'Japan', 13960000, 'Busy intersection in Shibuya district', 150,
    1.45, 1.42, 0.8, 2.1,
    2.3, 2.1, 0.5, 8.2,
    12.5, 11.8, 25.6, 24.8,
    35.6762, 139.6503, 'Video Analysis 2024', 'High pedestrian volume, efficient crossings'
),
(
    'New York City', 'USA', 8336817, 'Times Square pedestrian crossing', 120,
    1.52, 1.48, 0.9, 2.3,
    3.1, 2.8, 0.8, 12.5,
    15.2, 14.1, 28.4, 27.2,
    40.7580, -73.9855, 'Video Analysis 2024', 'Tourist-heavy area, mixed crossing behaviors'
),
(
    'Copenhagen', 'Denmark', 1346465, 'Bicycle-friendly intersection', 95,
    1.38, 1.35, 0.7, 1.9,
    1.8, 1.6, 0.3, 6.8,
    8.9, 8.2, 22.1, 21.5,
    55.6761, 12.5683, 'Video Analysis 2024', 'Excellent pedestrian infrastructure'
),
(
    'Amsterdam', 'Netherlands', 873338, 'Canal bridge crossing', 80,
    1.41, 1.39, 0.8, 2.0,
    2.0, 1.8, 0.4, 7.2,
    10.1, 9.5, 23.8, 23.1,
    52.3676, 4.9041, 'Video Analysis 2024', 'Historic city center, pedestrian priority'
),
(
    'Barcelona', 'Spain', 1636762, 'Rambla pedestrian street', 110,
    1.33, 1.30, 0.6, 1.8,
    2.5, 2.2, 0.6, 9.1,
    11.8, 11.0, 24.2, 23.6,
    41.3851, 2.1734, 'Video Analysis 2024', 'Tourist destination, relaxed crossing pace'
),
(
    'Singapore', 'Singapore', 5453566, 'Marina Bay crossing', 130,
    1.49, 1.46, 0.9, 2.2,
    2.7, 2.4, 0.7, 10.2,
    13.5, 12.8, 26.8, 26.1,
    1.2966, 103.7764, 'Video Analysis 2024', 'Efficient urban planning, disciplined crossings'
),
(
    'Berlin', 'Germany', 3669491, 'Brandenburg Gate area', 85,
    1.36, 1.33, 0.7, 1.9,
    2.2, 2.0, 0.5, 8.5,
    10.8, 10.1, 23.5, 22.9,
    52.5200, 13.4050, 'Video Analysis 2024', 'Historic landmark, moderate pedestrian flow'
),
(
    'Melbourne', 'Australia', 5078193, 'Flinders Street Station', 105,
    1.44, 1.41, 0.8, 2.1,
    2.8, 2.5, 0.6, 11.3,
    14.2, 13.4, 25.9, 25.2,
    -37.8136, 144.9631, 'Video Analysis 2024', 'Major transport hub, diverse pedestrian behavior'
),
(
    'Stockholm', 'Sweden', 975551, 'Gamla Stan old town', 70,
    1.39, 1.36, 0.7, 1.8,
    1.9, 1.7, 0.4, 6.9,
    9.8, 9.1, 22.8, 22.2,
    59.3293, 18.0686, 'Video Analysis 2024', 'Historic district, careful pedestrian behavior'
),
(
    'Vienna', 'Austria', 1951000, 'Stephansplatz central square', 90,
    1.37, 1.34, 0.7, 1.9,
    2.1, 1.9, 0.5, 7.8,
    11.2, 10.5, 23.9, 23.3,
    48.2082, 16.3738, 'Video Analysis 2024', 'Historic center, moderate crossing speeds'
);
