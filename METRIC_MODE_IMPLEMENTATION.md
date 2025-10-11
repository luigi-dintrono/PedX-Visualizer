# Metric Mode Implementation

## Overview
This document describes the newly implemented **Metric Mode** for the PedX Visualizer info sidebar. This mode is triggered when a user selects a behavior metric from the filter sidebar without pinning a specific city.

## Architecture

### API Endpoints

#### 1. `/api/metrics/[metric]/route.ts`
**Purpose:** Fetch comprehensive metric data including rankings and city values

**Features:**
- Returns metric metadata (name, unit, description)
- Global baseline statistics (average, total cities/videos/pedestrians)
- Ranked list of all cities by metric value
- Delta vs global average for each city
- Video and pedestrian counts per city

**Supported Metrics:**
- `risky_crossing` - Risky Crossing Rate (%)
- `run_red_light` - Run Red Light Rate (%)
- `crosswalk_usage` - Crosswalk Usage Rate (%)
- `phone_usage` - Phone Usage Rate (%)
- `crossing_speed` - Crossing Speed (m/s)
- `crossing_time` - Crossing Time (s)
- `avg_age` - Average Age (years)
- `pedestrian_density` - Pedestrian Density (peds/video)
- `road_width` - Road Width (m)

**Data Sources:**
- `mv_global_insights` - Global baseline statistics
- `mv_city_insights` - Pre-computed city rankings and metrics

#### 2. `/api/metrics/[metric]/relationships/route.ts`
**Purpose:** Fetch correlations and relationships between metrics and other factors

**Features:**
- Weather/daytime correlations (from `weather_daytime_stats.csv`)
- Gender demographic correlations (from `gender_stats.csv`)
- Vehicle type impacts (from `vehicle_stats.csv`)
- Effect size calculations
- Directional indicators (↑/↓)

**Relationship Categories:**
- Environmental (weather, time of day)
- Demographics (gender, age)
- Vehicles (car, bus, truck impacts)

## UI Components

### Metric Mode Layout

The info sidebar now has three distinct modes:
1. **Empty Mode** - No city or metric selected (shows welcome + top insights)
2. **Metric Mode** - Metric selected, no city (NEW - comprehensive metric analysis)
3. **City Mode** - City selected (detailed city information)

### Metric Mode Sections

#### 1. Header
- **Metric Name** with icon
- **Description** explaining what the metric measures
- **Global Average** badge showing baseline across all cities
- **Active Filters** chips displaying current filter selections

#### 2. Top Cities List
- Ranked list of cities (top 10 displayed prominently)
- Shows:
  - Rank number
  - Country flag emoji
  - City name and country
  - Metric value with unit
  - Delta vs global average (with color coding)
  - Number of videos analyzed
- Click to pin city and view detailed city mode

#### 3. Key Relationships
- Up to 6 most significant correlations
- Displays:
  - Factor name (e.g., "Rain + Night", "Male", "Bus")
  - Category icon (Environmental, Demographics, Vehicles)
  - Effect badge showing direction and magnitude
  - Descriptive text explaining the relationship
- Color-coded badges (red for increases, blue for decreases)

#### 4. Key Insights
- Bullet-point list of auto-generated insights:
  - Leading city with value and comparison
  - Most significant relationship effect
  - Data collection summary (total videos/pedestrians)

#### 5. All Cities Table
- Scrollable table showing all cities
- Columns:
  - Rank (#)
  - City name
  - Country
  - Metric value
  - Delta vs global (%)
  - Videos analyzed
- Click any row to pin that city
- Sticky header for easy reference while scrolling

## Data Flow

```
User selects metric from filter-sidebar
    ↓
FilterContext updates selectedMetrics
    ↓
InfoSidebar detects metric selection
    ↓
Fetches data from /api/metrics/[metric]
    ↓
Fetches relationships from /api/metrics/[metric]/relationships
    ↓
Renders comprehensive Metric Mode view
```

## Filter Integration

The Metric Mode respects granular filters from the left sidebar:
- **Continents** - Filter cities by continent
- **Weather** - Filter by weather conditions
- **Time of Day** - Filter by day/night
- **Gender** - Filter by demographic

Active filters are displayed as chips in the header section.

## Color Coding

- **Green (↓)** - Values below global average (good for negative metrics like risky_crossing)
- **Red (↑)** - Values above global average (bad for negative metrics)
- **Primary Blue** - Metric-related UI elements
- **Muted** - Secondary information and borders

## Performance Optimizations

1. **Materialized Views** - Uses pre-computed `mv_city_insights` and `mv_global_insights` for fast queries
2. **Lazy Loading** - Only fetches metric data when needed
3. **CSV Caching** - Relationship data loaded from pre-processed CSV files
4. **Efficient Sorting** - Top cities pre-sorted by database

## Future Enhancements

Potential improvements for future iterations:

1. **Charts & Visualizations**
   - Distribution histograms
   - Scatter plots showing correlations
   - Time-series trends

2. **Advanced Filtering**
   - Apply granular filters to city rankings
   - Filter by specific relationship factors
   - Date range filtering

3. **Export Functionality**
   - Download city rankings as CSV
   - Export relationship analysis
   - Generate PDF reports

4. **Comparison Mode**
   - Compare multiple metrics side-by-side
   - Multi-city comparison view
   - Benchmark against custom baselines

5. **Real-time Updates**
   - WebSocket integration for live data
   - Automatic refresh when new videos analyzed
   - Push notifications for significant changes

## Testing

To test the Metric Mode:

1. Start the development server: `npm run dev`
2. Open the application in your browser
3. In the left filter sidebar, click "Search by behaviour..."
4. Select any metric (e.g., "Risky Crossing Rate")
5. The right info sidebar should display the comprehensive Metric Mode view
6. Click on any city in the rankings to switch to City Mode
7. Clear the metric selection to return to Empty Mode

## Dependencies

- Next.js 15.5.4
- React 19.1.0
- PostgreSQL (via pg 8.11.3)
- csv-parse (for CSV data parsing)
- Lucide React (for icons)
- Radix UI (for UI components)

## Files Modified/Created

### New Files:
- `/src/app/api/metrics/[metric]/route.ts` - Main metric data endpoint
- `/src/app/api/metrics/[metric]/relationships/route.ts` - Relationships endpoint
- `/METRIC_MODE_IMPLEMENTATION.md` - This documentation

### Modified Files:
- `/src/components/info-sidebar.tsx` - Added Metric Mode implementation
- `/src/types/database.ts` - Added MetricData and MetricRelationship interfaces (implicit)

## Database Requirements

The Metric Mode relies on these database views:
- `mv_global_insights` - Global baseline statistics
- `mv_city_insights` - City-level metrics and rankings
- `v_city_summary` - City summary data

Ensure these views are created and populated before using Metric Mode. Run:
```bash
npm run setup-db
```

## Summary

The Metric Mode provides a comprehensive, data-driven view of pedestrian behavior metrics across all cities in the database. It enables researchers and urban planners to:
- Identify top-performing and under-performing cities
- Understand correlations with environmental and demographic factors
- Compare city performance against global averages
- Discover actionable insights for improving pedestrian safety

The implementation follows Next.js best practices, uses efficient database queries, and provides an intuitive, responsive user interface.

