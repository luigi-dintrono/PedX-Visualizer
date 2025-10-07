# CSV Data Aggregation Guide

This document provides detailed information about the CSV data aggregation system for the PEDX Visualizer.

## Overview

The aggregation system processes CSV files from the `summary_data` folder and transforms them into structured PostgreSQL tables. It uses a flexible analytics schema that supports hierarchical analysis and rich contextual data.

## Database Schema

### Analytics Dimensions Table

```sql
CREATE TABLE analytics_dimensions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,           -- Logical group (e.g., "gender_stats")
    dimension VARCHAR(255) NOT NULL,             -- Independent variable (e.g., "gender")
    target_metric VARCHAR(255) NOT NULL,         -- Dependent metric (e.g., "risky_crossing_rate")
    level VARCHAR(50) NOT NULL DEFAULT 'global', -- Analysis level
    description TEXT,                            -- Optional description
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Analytics Facts Table

```sql
CREATE TABLE analytics_facts (
    id SERIAL PRIMARY KEY,
    dimension_name VARCHAR(255) NOT NULL,        -- FK to analytics_dimensions.name
    dimension_value VARCHAR(255) NOT NULL,       -- Category value (e.g., "male")
    target_metric VARCHAR(255) NOT NULL,         -- Metric being measured
    value DECIMAL(15, 6),                        -- Numeric value
    context_city_id INTEGER,                     -- Optional city context
    context_video_id INTEGER,                    -- Optional video context
    extra JSONB,                                 -- Additional metrics/context
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (dimension_name) REFERENCES analytics_dimensions(name) ON DELETE CASCADE,
    FOREIGN KEY (context_city_id) REFERENCES CoreGlobalCrossingData(id) ON DELETE SET NULL,
    
    UNIQUE(dimension_name, dimension_value, target_metric, context_city_id, context_video_id)
);
```

## Supported CSV Files

### Core Data Files

#### all_video_info.csv
Contains video metadata and aggregated metrics:
- Video identification (city, link, video_name)
- Timing data (duration_seconds, total_frames)
- Pedestrian counts and ratios
- Environmental conditions (weather, infrastructure)
- Geographic data (coordinates, demographics)

#### all_time_info.csv
Contains video timing analysis:
- duration_seconds: Total video duration
- analysis_seconds: Actual analysis duration

#### all_pedestrian_info.csv
Contains individual pedestrian observations:
- Basic info (track_id, crossed, gender, age)
- Behavior (risky_crossing, run_red_light, crosswalk_use)
- Clothing and accessories
- Environmental context
- Vehicle interactions

### Analytics Files

#### Gender Statistics (gender_stats.csv)
```csv
gender,risky_crossing,run_red_light
female,0.2631578947368421,0.07894736842105263
male,0.23076923076923078,0.07692307692307693
```

#### Age Statistics (age_stats.csv)
```csv
age,risky_crossing,run_red_light
20,0.0,0.0
27,1.0,0.0
28,0.0,0.0
...
```

#### Weather/Daytime Statistics (weather_daytime_stats.csv)
```csv
weather,daytime,run_red_light_prob,risky_crossing_prob
shine,0,14.285714285714285,14.285714285714285
shine,1,0.0,12.5
rain,0,8.333333333333332,25.0
...
```

#### Road Correlation (road_corr.csv)
```csv
index,risky_crossing,run_red_light
avg_vehicle_total,0.030831611859857465,0.13424673289351208
avg_road_width,-0.05518794996864166,-0.08877233196377927
```

#### Crosswalk Coefficients (crosswalk_coeff.csv)
```csv
continent,crosswalk_usage_ratio,crosswalk_prob,crosswalk_coeff
Europe,0.8333333333333334,0.1032178153949371,8.073541666666673
```

## Usage

### First Time Setup

```bash
npm run aggregate-csv-fresh
```

This will:
- Drop and recreate all tables
- Process all CSV files
- Create dimensions and facts
- Generate summary statistics

### Incremental Updates

```bash
npm run aggregate-csv
```

This will:
- Add new data without duplicates
- Update existing records if changed
- Skip files that haven't changed
- Maintain data integrity

### Verbose Logging

```bash
npm run aggregate-csv-verbose
```

Shows detailed processing information for debugging.

## Configuration

### Dimension Configurations

The script uses predefined configurations for each CSV file type:

```javascript
{
    name: 'gender_stats',
    dimension: 'gender',
    dimensionColumn: 'gender',
    targetMetric: 'gender_analysis',
    level: 'global',
    description: 'Analysis of pedestrian behavior by gender',
    metrics: [
        { csvColumn: 'risky_crossing', targetMetric: 'risky_crossing_rate' },
        { csvColumn: 'run_red_light', targetMetric: 'run_red_light_rate' }
    ]
}
```

### Adding New CSV Files

To add support for new CSV files:

1. Add the file to the `statsFiles` array in the aggregation script
2. Create a dimension configuration in `getDimensionConfigs()`
3. Define the column mappings and target metrics
4. Test with verbose logging

## Query Examples

### Basic Analytics Queries

```sql
-- Get all gender statistics
SELECT * FROM analytics_global WHERE dimension_name = 'gender_stats';

-- Get risky crossing rates by age
SELECT dimension_value as age, value as risky_crossing_rate 
FROM analytics_facts 
WHERE dimension_name = 'age_stats' 
  AND target_metric = 'risky_crossing_rate'
ORDER BY dimension_value::INTEGER;

-- Get weather impact on behavior
SELECT dimension_value as weather, value as risky_crossing_rate
FROM analytics_facts
WHERE dimension_name = 'weather_daytime_stats'
  AND target_metric = 'risky_crossing_rate';
```

### Cross-Dimensional Analysis

```sql
-- Compare gender vs age for risky crossing
SELECT 
    af1.dimension_value as gender,
    af2.dimension_value as age,
    af1.value as risky_crossing_rate
FROM analytics_facts af1
JOIN analytics_facts af2 ON af1.target_metric = af2.target_metric
WHERE af1.dimension_name = 'gender_stats'
  AND af2.dimension_name = 'age_stats'
  AND af1.target_metric = 'risky_crossing_rate'
ORDER BY af1.dimension_value, af2.dimension_value;
```

### Using the JSONB Extra Field

```sql
-- Get crosswalk data with all related metrics
SELECT 
    dimension_value as continent,
    value as crosswalk_usage_rate,
    extra->>'crosswalk_probability' as probability,
    extra->>'crosswalk_coefficient' as coefficient
FROM analytics_facts
WHERE dimension_name = 'crosswalk_coefficient_stats';
```

## Error Handling

The aggregation script includes comprehensive error handling:

- **File Not Found**: Logs warning and continues with other files
- **Invalid Data**: Safely parses numeric values, skips invalid rows
- **Database Errors**: Logs error and continues processing
- **Duplicate Data**: Uses `ON CONFLICT` to handle duplicates gracefully

## Performance Considerations

- **Batch Processing**: Processes files sequentially to avoid memory issues
- **Caching**: Maintains in-memory caches for efficient lookups
- **Indexes**: Database includes optimized indexes for fast queries
- **JSONB**: Uses PostgreSQL JSONB for flexible extra data storage

## Troubleshooting

### Common Issues

1. **CSV Parsing Errors**
   - Check CSV file format and encoding
   - Verify column names match expected format
   - Use verbose logging to see detailed processing

2. **Database Connection Issues**
   - Ensure `DATABASE_URL` is set correctly
   - Verify PostgreSQL is running and accessible
   - Check database permissions

3. **Memory Issues with Large Files**
   - Process files individually if needed
   - Consider splitting very large CSV files
   - Monitor system resources during processing

### Debugging

Use verbose logging to troubleshoot issues:

```bash
npm run aggregate-csv-verbose
```

This will show:
- File processing progress
- Row-by-row processing details
- Database operation results
- Error details and context

## Future Enhancements

The aggregation system is designed to be extensible:

- **New File Types**: Easy to add support for new CSV formats
- **Custom Metrics**: Flexible metric definitions
- **Hierarchical Analysis**: Support for multi-level analysis
- **Real-time Updates**: Potential for streaming data processing
- **Data Validation**: Enhanced validation rules and constraints
