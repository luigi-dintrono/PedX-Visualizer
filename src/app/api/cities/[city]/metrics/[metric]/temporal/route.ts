import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/database';

/**
 * GET /api/cities/[city]/metrics/[metric]/temporal
 * 
 * Fetches temporal data for a specific metric in a city
 * Returns data points over time for visualization
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ city: string; metric: string }> }
) {
  try {
    const { city: cityParam, metric } = await params;
    const city = decodeURIComponent(cityParam);
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '6'); // Default to 6 months

    // Map metric names to database columns
    const metricMap: { [key: string]: { column: string; unit: string; name: string } } = {
      'crossing-speed': {
        column: 'avg_crossing_speed',
        unit: 'm/s',
        name: 'Crossing Speed'
      },
      'crossing-time': {
        column: 'avg_crossing_time',
        unit: 'seconds',
        name: 'Time to Start'
      },
      'risky-crossing': {
        column: 'risky_crossing_rate',
        unit: '%',
        name: 'Risky Crossing Rate'
      },
      'red-light': {
        column: 'run_red_light_rate',
        unit: '%',
        name: 'Red Light Rate'
      },
      'crosswalk-usage': {
        column: 'crosswalk_usage_rate',
        unit: '%',
        name: 'Crosswalk Usage Rate'
      }
    };

    const metricConfig = metricMap[metric];
    if (!metricConfig) {
      return NextResponse.json(
        { success: false, error: `Unknown metric: ${metric}` },
        { status: 400 }
      );
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // Generate monthly date series
    const dateSeries: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      dateSeries.push(new Date(current));
      current.setMonth(current.getMonth() + 1);
    }

    // First, get current data to ensure we have at least one point
    const currentQuery = await pool.query(
      `SELECT ${metricConfig.column} as value 
       FROM v_city_summary 
       WHERE city = $1 
       LIMIT 1`,
      [city]
    );

    let currentValue: number | null = null;
    if (currentQuery.rows.length > 0 && currentQuery.rows[0].value !== null && currentQuery.rows[0].value !== undefined) {
      const parsed = parseFloat(currentQuery.rows[0].value);
      if (!isNaN(parsed)) {
        currentValue = parsed;
      }
    }

    // Query temporal data for each month
    const dataPoints: Array<{ date: string; value: number | null }> = [];
    
    // Get city ID first for direct video queries
    const cityIdResult = await pool.query('SELECT id FROM cities WHERE city = $1 LIMIT 1', [city]);
    const cityId = cityIdResult.rows.length > 0 ? cityIdResult.rows[0].id : null;

    if (!cityId) {
      // If no city found, return empty data
      return NextResponse.json({
        success: true,
        data: {
          metric: {
            key: metric,
            name: metricConfig.name,
            unit: metricConfig.unit
          },
          chartData: [],
          dateRange: {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
            months
          }
        }
      });
    }

    // Query videos directly grouped by month for better performance and accuracy
    // This approach aggregates data for each month based on when videos were collected/imported
    let monthlyQuery: string;
    
    if (metricConfig.column === 'risky_crossing_rate' || 
        metricConfig.column === 'run_red_light_rate' || 
        metricConfig.column === 'crosswalk_usage_rate') {
      // Calculate from pedestrians
      const pedestrianField = metricConfig.column === 'risky_crossing_rate' ? 'risky_crossing' :
                             metricConfig.column === 'run_red_light_rate' ? 'run_red_light' :
                             'crosswalk_use_or_not';
      
      monthlyQuery = `
        WITH monthly_data AS (
          SELECT 
            date_trunc('month', COALESCE(v.data_collected_date, v.first_imported_at::DATE, v.created_at::DATE))::DATE as month_date,
            COUNT(CASE WHEN p.${pedestrianField} THEN 1 END)::FLOAT / NULLIF(COUNT(p.id), 0) as metric_value
          FROM videos v
          LEFT JOIN pedestrians p ON v.id = p.video_id
          WHERE v.city_id = $1
            AND COALESCE(v.data_collected_date, v.first_imported_at::DATE, v.created_at::DATE) >= $2::DATE
            AND COALESCE(v.data_collected_date, v.first_imported_at::DATE, v.created_at::DATE) <= $3::DATE
          GROUP BY month_date
        ),
        date_series AS (
          SELECT generate_series(
            date_trunc('month', $2::DATE)::DATE,
            date_trunc('month', $3::DATE)::DATE,
            '1 month'::INTERVAL
          )::DATE as month_date
        )
        SELECT 
          ds.month_date as date,
          md.metric_value as value
        FROM date_series ds
        LEFT JOIN monthly_data md ON ds.month_date = md.month_date
        ORDER BY ds.month_date ASC
      `;
    } else {
      // Use video columns directly (crossing_speed, crossing_time)
      const videoColumn = metricConfig.column.replace('avg_', '');
      monthlyQuery = `
        WITH monthly_data AS (
          SELECT 
            date_trunc('month', COALESCE(v.data_collected_date, v.first_imported_at::DATE, v.created_at::DATE))::DATE as month_date,
            AVG(v.${videoColumn}) as metric_value
          FROM videos v
          WHERE v.city_id = $1
            AND COALESCE(v.data_collected_date, v.first_imported_at::DATE, v.created_at::DATE) >= $2::DATE
            AND COALESCE(v.data_collected_date, v.first_imported_at::DATE, v.created_at::DATE) <= $3::DATE
          GROUP BY month_date
        ),
        date_series AS (
          SELECT generate_series(
            date_trunc('month', $2::DATE)::DATE,
            date_trunc('month', $3::DATE)::DATE,
            '1 month'::INTERVAL
          )::DATE as month_date
        )
        SELECT 
          ds.month_date as date,
          md.metric_value as value
        FROM date_series ds
        LEFT JOIN monthly_data md ON ds.month_date = md.month_date
        ORDER BY ds.month_date ASC
      `;
    }

    try {
      const monthlyResult = await pool.query(monthlyQuery, [
        cityId,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      ]);

      // Process results - only include months with actual data
      // Also forward-fill to show trends (use last known value for months without data)
      let lastKnownValue: number | null = null;
      for (const row of monthlyResult.rows) {
        const rowDate = new Date(row.date);
        if (row.value !== null && row.value !== undefined) {
          const parsed = parseFloat(String(row.value));
          if (!isNaN(parsed)) {
            lastKnownValue = parsed;
            dataPoints.push({
              date: rowDate.toISOString().split('T')[0],
              value: parsed
            });
          } else if (lastKnownValue !== null) {
            // Forward-fill with last known value for continuity in the chart
            dataPoints.push({
              date: rowDate.toISOString().split('T')[0],
              value: lastKnownValue
            });
          }
        } else if (lastKnownValue !== null) {
          // Forward-fill with last known value for continuity
          dataPoints.push({
            date: rowDate.toISOString().split('T')[0],
            value: lastKnownValue
          });
        }
      }
      
      console.log(`Temporal data for ${city}: Found ${dataPoints.length} data points`);
    } catch (error) {
      console.error('Error querying monthly temporal data:', error);
      // Fall back to empty array, will use current value below
    }

    // If no historical data points but we have current data, add it
    // This ensures we always show at least one data point if current data exists
    if (dataPoints.length === 0 && currentValue !== null && !isNaN(currentValue)) {
      dataPoints.push({
        date: endDate.toISOString().split('T')[0],
        value: currentValue
      });
    }

    const result = { rows: dataPoints };

    // Format data for chart - include 0 values but filter out null
    const chartData = result.rows
      .filter(row => row.value !== null && row.value !== undefined)
      .map(row => ({
        date: new Date(row.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        value: typeof row.value === 'number' ? row.value : parseFloat(String(row.value)) || 0,
        fullDate: row.date
      }));

    return NextResponse.json({
      success: true,
      data: {
        metric: {
          key: metric,
          name: metricConfig.name,
          unit: metricConfig.unit
        },
        chartData,
        dateRange: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0],
          months
        }
      }
    });
  } catch (error) {
    console.error('Error fetching temporal metric data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch temporal metric data' },
      { status: 500 }
    );
  }
}

