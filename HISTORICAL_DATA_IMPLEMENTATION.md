# Historical Data Implementation Guide

This document describes the implementation of historical data tracking for the PEDX Visualizer project. The system supports **cumulative aggregation** by default (all data combined) and **temporal queries** on demand (data at specific points in time).

## Overview

The hybrid approach ensures that:
- **General views (default)**: Aggregate ALL data cumulatively from all time periods
- **Temporal views (on request)**: Filter by date to show historical state at specific points in time
- **Video updates**: Same video link = update existing record (not duplicate), with tracking of when data was collected/imported

## Architecture

### Database Schema Changes

#### 1. Import Batches Table
Tracks each data import run:
```sql
CREATE TABLE import_batches (
    id SERIAL PRIMARY KEY,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    description TEXT,
    file_count INTEGER,
    record_count INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb
);
```

#### 2. Videos Table Extensions
Added temporal tracking columns:
- `data_collected_date DATE` - When data was originally collected
- `import_batch_id INTEGER` - Which import batch added this data
- `first_imported_at TIMESTAMP` - First time this video was imported
- `last_updated_at TIMESTAMP` - Last time this video was updated

#### 3. Video Update History Table (Optional)
Tracks when videos were updated for historical analysis:
```sql
CREATE TABLE video_update_history (
    id SERIAL PRIMARY KEY,
    video_id INTEGER REFERENCES videos(id),
    import_batch_id INTEGER REFERENCES import_batches(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    risky_crossing_ratio DECIMAL(5, 4),
    run_red_light_ratio DECIMAL(5, 4),
    crosswalk_usage_ratio DECIMAL(5, 4),
    total_pedestrians INTEGER,
    metrics_snapshot JSONB
);
```

### Views and Functions

#### 1. Cumulative View (Default)
`v_city_summary` - Aggregates ALL videos from all time periods:
- No date filtering
- Shows cumulative totals and averages
- Includes temporal metadata (earliest/latest dates) for reference

#### 2. Temporal Function
`v_city_summary_at_date(target_date DATE)` - Returns data as it existed at a specific date:
- Filters videos by `data_collected_date <= target_date` and `first_imported_at <= target_date`
- Shows historical state at that point in time
- Useful for comparisons and trend analysis

#### 3. Comparison Function
`compare_city_data_current_vs_date(target_date, city_name)` - Compares current vs historical:
- Returns side-by-side comparison
- Calculates changes (video count, metrics, etc.)
- Shows period in days

#### 4. Import Batch Statistics
`get_import_batch_stats()` - Returns statistics for each import batch:
- Video count per batch
- City count per batch
- Pedestrian count per batch

## API Changes

### Cities Endpoint
**GET `/api/cities`**

**Default (Cumulative):**
```bash
GET /api/cities
# Returns all data combined from all time periods
```

**Temporal Query:**
```bash
GET /api/cities?date=2024-01-01
# Returns data as it existed on 2024-01-01
```

**Response includes metadata:**
```json
{
  "success": true,
  "data": [...],
  "metadata": {
    "date_filter": "2024-01-01" | null,
    "is_temporal": true | false,
    "data_range": "Data as of 2024-01-01" | "All available data (cumulative)"
  }
}
```

### Comparison Endpoint
**GET `/api/cities/compare`**

```bash
GET /api/cities/compare?date=2024-01-01&city=Barcelona
```

**Response:**
```json
{
  "success": true,
  "data": [{
    "city": "Barcelona",
    "current_total_videos": 150,
    "historical_total_videos": 100,
    "video_count_change": 50,
    "risky_crossing_change": 0.05,
    "change_period_days": 180
  }],
  "comparison_date": "2024-01-01"
}
```

## Aggregation Script Changes

The `scripts/aggregate-csv-data.js` script has been updated to:

1. **Create import batches**: Each aggregation run creates a new import batch record
2. **Track temporal data**: Videos are tagged with `import_batch_id` and `data_collected_date`
3. **Preserve first import date**: When updating existing videos, `first_imported_at` is preserved
4. **Track update history**: Optional history tracking for videos that are updated

### Key Methods

```javascript
// Start a new import batch
await aggregator.startImportBatch('CSV data aggregation');

// Process videos (automatically tracks import batch)
await aggregator.aggregateVideos(videoData, timeMap);

// Finalize import batch (updates record counts)
await aggregator.finalizeImportBatch();
```

## Migration

### For New Databases
The schema is already updated in `database/schema.sql`. Just run:
```bash
make db-setup
```

### For Existing Databases
Run the migration script:
```bash
make db-migrate-temporal-tracking
```

This will:
1. Create `import_batches` and `video_update_history` tables
2. Add temporal columns to `videos` table
3. Create temporal functions and views
4. Migrate existing data (creates initial import batch for existing videos)

## Usage Examples

### SQL Queries

**Get all cumulative data (default):**
```sql
SELECT * FROM v_city_summary;
```

**Get data as of 6 months ago:**
```sql
SELECT * FROM v_city_summary_at_date(CURRENT_DATE - INTERVAL '6 months');
```

**Compare current vs 6 months ago:**
```sql
SELECT * FROM compare_city_data_current_vs_date(
    CURRENT_DATE - INTERVAL '6 months',
    'Barcelona'
);
```

**Get import batch statistics:**
```sql
SELECT * FROM get_import_batch_stats();
```

### API Usage

**Default (all data):**
```typescript
const response = await fetch('/api/cities');
const { data, metadata } = await response.json();
// metadata.is_temporal = false
// metadata.data_range = "All available data (cumulative)"
```

**Historical data:**
```typescript
const response = await fetch('/api/cities?date=2024-01-01');
const { data, metadata } = await response.json();
// metadata.is_temporal = true
// metadata.data_range = "Data as of 2024-01-01"
```

**Comparison:**
```typescript
const response = await fetch('/api/cities/compare?date=2024-01-01&city=Barcelona');
const { data } = await response.json();
// data[0].video_count_change = 50 (new videos added)
// data[0].change_period_days = 180
```

## Data Flow

1. **New Data Import:**
   - Aggregation script creates new import batch
   - Videos are processed and tagged with `import_batch_id`
   - If video exists (same link), it's updated but `first_imported_at` is preserved
   - Update history is optionally recorded

2. **General Queries (Default):**
   - Use `v_city_summary` view
   - Aggregates ALL videos regardless of import date
   - Shows cumulative totals

3. **Temporal Queries:**
   - Use `v_city_summary_at_date(date)` function
   - Filters videos by date criteria
   - Shows historical state

4. **Comparisons:**
   - Use `compare_city_data_current_vs_date()` function
   - Compares cumulative view vs temporal view
   - Calculates changes

## Benefits

1. **No Breaking Changes**: Default behavior remains cumulative (all data)
2. **Historical Analysis**: Can query data at any point in time
3. **Trend Tracking**: Compare metrics over time
4. **Import Tracking**: Know which import batch added which data
5. **Flexible**: Can add `data_collected_date` to CSV files for more precise tracking

## Troubleshooting

### Migration Issues
If migration fails, check:
- Database connection
- Existing data constraints
- Foreign key dependencies

### Temporal Queries Return No Data
- Check if `data_collected_date` or `first_imported_at` are set
- Verify date format (YYYY-MM-DD)
- Check if videos exist for that time period

### Import Batch Not Created
- Check aggregation script logs
- Verify database connection
- Check for errors in `startImportBatch()` method

## Related Files

- `database/schema.sql` - Main schema with temporal tracking
- `scripts/migrate-add-temporal-tracking.sql` - Migration script
- `scripts/aggregate-csv-data.js` - Updated aggregation script
- `src/app/api/cities/route.ts` - Updated API with date parameter
- `src/app/api/cities/compare/route.ts` - New comparison endpoint
- `Makefile` - Added `db-migrate-temporal-tracking` command

