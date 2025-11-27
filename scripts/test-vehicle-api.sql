-- Test Vehicle Counts for Ho Chi Minh City
-- Compare direct query vs API query

-- 1. Direct Database Query (using CTE - same as API)
SELECT '1. Direct Database Query (using CTE):' as test;
WITH city_vehicle_counts AS (
    SELECT 
        c.id,
        COALESCE(COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)), 0)::INTEGER as car_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)), 0)::INTEGER as bus_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)), 0)::INTEGER as truck_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)), 0)::INTEGER as motorbike_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)), 0)::INTEGER as bicycle_count
    FROM cities c
    LEFT JOIN videos v ON c.id = v.city_id
    LEFT JOIN pedestrians p ON v.id = p.video_id
    WHERE c.city = 'Ho Chi Minh City'
    GROUP BY c.id
)
SELECT 
    vcs.id,
    vcs.city,
    vcs.country,
    cvc.car_count,
    cvc.bus_count,
    cvc.truck_count,
    cvc.motorbike_count,
    cvc.bicycle_count,
    vcs.total_pedestrians,
    vcs.total_videos
FROM v_city_summary vcs
INNER JOIN city_vehicle_counts cvc ON vcs.id = cvc.id
WHERE vcs.city = 'Ho Chi Minh City'
    AND vcs.latitude IS NOT NULL 
    AND vcs.longitude IS NOT NULL
    AND vcs.total_pedestrians > 0;

-- 2. Test API Query with vehicle filters (car: 0-500, bus: 0-500) - should include Ho Chi Minh City
SELECT '' as separator;
SELECT '2. API Query with filters (car: 0-500, bus: 0-500) - should include Ho Chi Minh City:' as test;
WITH city_vehicle_counts AS (
    SELECT 
        c.id,
        COALESCE(COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)), 0)::INTEGER as car_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)), 0)::INTEGER as bus_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)), 0)::INTEGER as truck_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)), 0)::INTEGER as motorbike_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)), 0)::INTEGER as bicycle_count
    FROM cities c
    LEFT JOIN videos v ON c.id = v.city_id
    LEFT JOIN pedestrians p ON v.id = p.video_id
    GROUP BY c.id
)
SELECT 
    vcs.city,
    vcs.country,
    cvc.car_count,
    cvc.bus_count,
    cvc.truck_count,
    cvc.motorbike_count,
    cvc.bicycle_count
FROM v_city_summary vcs
INNER JOIN city_vehicle_counts cvc ON vcs.id = cvc.id
WHERE vcs.latitude IS NOT NULL 
  AND vcs.longitude IS NOT NULL
  AND vcs.total_pedestrians > 0
  AND cvc.car_count >= 0
  AND cvc.car_count <= 500
  AND cvc.bus_count >= 0
  AND cvc.bus_count <= 500
  AND vcs.city = 'Ho Chi Minh City';

-- 3. Test with restrictive filters (car: 0-100, bus: 0-50) - should EXCLUDE Ho Chi Minh City
SELECT '' as separator;
SELECT '3. API Query with restrictive filters (car: 0-100, bus: 0-50) - should EXCLUDE Ho Chi Minh City:' as test;
WITH city_vehicle_counts AS (
    SELECT 
        c.id,
        COALESCE(COUNT(*) FILTER (WHERE (p.car IS TRUE OR p.car::int = 1)), 0)::INTEGER as car_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.bus IS TRUE OR p.bus::int = 1)), 0)::INTEGER as bus_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.truck IS TRUE OR p.truck::int = 1)), 0)::INTEGER as truck_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.motorbike IS TRUE OR p.motorbike::int = 1)), 0)::INTEGER as motorbike_count,
        COALESCE(COUNT(*) FILTER (WHERE (p.bicycle IS TRUE OR p.bicycle::int = 1)), 0)::INTEGER as bicycle_count
    FROM cities c
    LEFT JOIN videos v ON c.id = v.city_id
    LEFT JOIN pedestrians p ON v.id = p.video_id
    GROUP BY c.id
)
SELECT 
    vcs.city,
    vcs.country,
    cvc.car_count,
    cvc.bus_count
FROM v_city_summary vcs
INNER JOIN city_vehicle_counts cvc ON vcs.id = cvc.id
WHERE vcs.latitude IS NOT NULL 
  AND vcs.longitude IS NOT NULL
  AND vcs.total_pedestrians > 0
  AND cvc.car_count >= 0
  AND cvc.car_count <= 100
  AND cvc.bus_count >= 0
  AND cvc.bus_count <= 50
  AND vcs.city = 'Ho Chi Minh City';

SELECT '' as separator;
SELECT 'Expected: Query 1 and 2 should return Ho Chi Minh City with vehicle counts.' as note;
SELECT 'Query 3 should return 0 rows (Ho Chi Minh City excluded because car=431 > 100 and bus=235 > 50).' as note;

