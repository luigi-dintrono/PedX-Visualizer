-- ============================================================================
-- migrate-fix-compare-ambiguous-city.sql
--
-- Idempotent (CREATE OR REPLACE). Fixes a hard 500 on /api/cities/compare.
--
-- compare_city_data_current_vs_date() declares `city` as a RETURNS TABLE output
-- column. In PL/pgSQL that name becomes a variable in scope for the whole body, so
-- the bare `city` in each CTE's WHERE clause is ambiguous against v_city_summary.city:
--
--   ERROR 42702: column reference "city" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- The function therefore threw on EVERY call, and the route surfaced it as a 500.
-- Both filters are now qualified with their source relation, which resolves the
-- reference to the column and leaves the result set unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION compare_city_data_current_vs_date(
    target_date DATE,
    city_name_param VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    city VARCHAR,
    country VARCHAR,
    current_total_videos BIGINT,
    current_avg_risky_crossing DECIMAL,
    current_avg_crossing_speed DECIMAL,
    current_risky_crossing_rate DECIMAL,
    historical_total_videos BIGINT,
    historical_avg_risky_crossing DECIMAL,
    historical_avg_crossing_speed DECIMAL,
    historical_risky_crossing_rate DECIMAL,
    video_count_change BIGINT,
    risky_crossing_change DECIMAL,
    crossing_speed_change DECIMAL,
    change_period_days INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH current_data AS (
        -- Qualified: bare `city` would bind to the RETURNS TABLE variable, not the column.
        SELECT * FROM v_city_summary
        WHERE (city_name_param IS NULL OR v_city_summary.city = city_name_param)
    ),
    historical_data AS (
        SELECT * FROM v_city_summary_at_date(target_date) AS d
        WHERE (city_name_param IS NULL OR d.city = city_name_param)
    )
    SELECT
        COALESCE(c.city, h.city) as city,
        COALESCE(c.country, h.country) as country,
        c.total_videos as current_total_videos,
        c.avg_risky_crossing_ratio as current_avg_risky_crossing,
        c.avg_crossing_speed as current_avg_crossing_speed,
        c.risky_crossing_rate as current_risky_crossing_rate,
        h.total_videos as historical_total_videos,
        h.avg_risky_crossing_ratio as historical_avg_risky_crossing,
        h.avg_crossing_speed as historical_avg_crossing_speed,
        h.risky_crossing_rate as historical_risky_crossing_rate,
        (c.total_videos - COALESCE(h.total_videos, 0)) as video_count_change,
        (c.avg_risky_crossing_ratio - COALESCE(h.avg_risky_crossing_ratio, 0)) as risky_crossing_change,
        (c.avg_crossing_speed - COALESCE(h.avg_crossing_speed, 0)) as crossing_speed_change,
        (CURRENT_DATE - target_date) as change_period_days
    FROM current_data c
    FULL OUTER JOIN historical_data h ON c.city = h.city AND c.country = h.country;
END;
$$ LANGUAGE plpgsql;
