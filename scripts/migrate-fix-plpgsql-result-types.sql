-- ============================================================================
-- migrate-fix-plpgsql-result-types.sql
--
-- Idempotent (CREATE OR REPLACE). Fixes two PL/pgSQL functions that threw on every
-- call. Both were found by invoking every user-defined function in the schema, not by
-- reading the code — neither failure was reachable through the UI, and the compare one
-- surfaced only as a generic 500.
--
--   compare_city_data_current_vs_date  ->  42702 then 42804  (/api/cities/compare 500)
--   get_city_insights                  ->  42804             (no caller today)
--
-- --- compare_city_data_current_vs_date -------------------------------------------
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
--
-- Fixing that unmasked a SECOND error that the first one had been hiding:
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type double precision does not match expected type numeric in column 6.
--
-- v_city_summary.risky_crossing_rate is `double precision`, while the same column from
-- v_city_summary_at_date() is `numeric` and the function declares both as DECIMAL. The
-- projected columns are now cast explicitly to their declared types, so the function no
-- longer depends on the two sources happening to agree.
--
-- --- get_city_insights ------------------------------------------------------------
--
-- Same class of defect, never noticed because nothing calls it:
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type double precision does not match expected type numeric in column 9.
--
-- Column 9 is risk_intensity, which is `double precision` in v_city_summary but declared
-- DECIMAL here. Cast explicitly, same as above.
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
        COALESCE(c.city, h.city)::VARCHAR                              as city,
        COALESCE(c.country, h.country)::VARCHAR                        as country,
        c.total_videos::BIGINT                                         as current_total_videos,
        c.avg_risky_crossing_ratio::DECIMAL                            as current_avg_risky_crossing,
        c.avg_crossing_speed::DECIMAL                                  as current_avg_crossing_speed,
        c.risky_crossing_rate::DECIMAL                                 as current_risky_crossing_rate,
        h.total_videos::BIGINT                                         as historical_total_videos,
        h.avg_risky_crossing_ratio::DECIMAL                            as historical_avg_risky_crossing,
        h.avg_crossing_speed::DECIMAL                                  as historical_avg_crossing_speed,
        h.risky_crossing_rate::DECIMAL                                 as historical_risky_crossing_rate,
        (c.total_videos - COALESCE(h.total_videos, 0))::BIGINT         as video_count_change,
        (c.avg_risky_crossing_ratio - COALESCE(h.avg_risky_crossing_ratio, 0))::DECIMAL as risky_crossing_change,
        (c.avg_crossing_speed - COALESCE(h.avg_crossing_speed, 0))::DECIMAL             as crossing_speed_change,
        (CURRENT_DATE - target_date)::INTEGER                          as change_period_days
    FROM current_data c
    FULL OUTER JOIN historical_data h ON c.city = h.city AND c.country = h.country;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_city_insights(city_id_param INTEGER)
RETURNS TABLE (
    city_name VARCHAR(255),
    country VARCHAR(255),
    continent VARCHAR(255),
    total_videos BIGINT,
    total_pedestrians BIGINT,
    avg_risky_crossing_rate DECIMAL,
    avg_run_red_light_rate DECIMAL,
    avg_crosswalk_usage_rate DECIMAL,
    risk_intensity DECIMAL,
    global_rank BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        vs.city::VARCHAR(255),
        vs.country::VARCHAR(255),
        vs.continent::VARCHAR(255),
        vs.total_videos::BIGINT,
        vs.total_pedestrians::BIGINT,
        vs.avg_risky_crossing_ratio::DECIMAL,
        vs.avg_run_red_light_ratio::DECIMAL,
        vs.avg_crosswalk_usage_ratio::DECIMAL,
        -- v_city_summary.risk_intensity is double precision, declared DECIMAL above.
        vs.risk_intensity::DECIMAL,
        mv.crossing_speed_rank::BIGINT
    FROM v_city_summary vs
    LEFT JOIN mv_rank_crossing_speed mv ON vs.id = mv.city_id
    WHERE vs.id = city_id_param;
END;
$$ LANGUAGE plpgsql;
