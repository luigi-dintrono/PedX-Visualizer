# PedX Visualizer

A minimal Next.js application with CesiumJS integration for 3D globe visualization and data analysis.

## Features

- **CesiumJS Integration**: Full-screen 3D globe with static asset optimization
- **shadcn/ui Components**: Modern UI with floating sidebars
- **PostgreSQL Database**: CoreGlobalCrossingData with pre-computed insights
- **RESTful APIs**: City insights and metric analysis endpoints
- **TypeScript**: Full type safety
- **Tailwind CSS**: Utility-first styling
- **Responsive Design**: Optimized for desktop and mobile

## Quick Start

### Using Makefile (Recommended)

```bash
# Clone and setup
git clone <your-repo>
cd pedx-visualizer

# Complete setup and start
make full-pipeline

# Or step by step:
make setup          # Install dependencies and setup environment
make db-setup       # Initialize database schema
make db-aggregate   # Load CSV data
make dev            # Start development server
```

### Using npm scripts

```bash
# Clone and setup
git clone <your-repo>
cd pedx-visualizer
npm install
npm run setup
npm run dev
```

## Makefile Commands

The project includes a comprehensive Makefile for easy development and deployment:

### Essential Commands

```bash
make help              # Show all available commands
make full-pipeline     # Complete setup and data pipeline
make dev               # Start development server
make db-aggregate      # Update database from CSV data
make db-refresh-views  # Refresh materialized views
```

### Setup & Installation

```bash
make setup             # Initial project setup (install deps, create .env)
make install           # Install all dependencies
make check-env         # Check environment configuration
make check-deps        # Verify required dependencies
```

### Database Operations

```bash
make db-setup                    # Initialize database schema
make db-reset                    # Reset database (destructive!)
make db-aggregate                # Aggregate CSV data into database
make db-refresh-views            # Refresh materialized views
make db-generate-insights        # Generate city insights from data
make db-generate-insights-verbose # Generate insights with detailed logging
make db-generate-insights-dry    # Test insights generation (dry run)
make db-pipeline                 # Complete database update (aggregate + refresh + insights)
make db-refresh-all              # Refresh views and regenerate insights
```

### Application Management

```bash
make dev               # Start development server with hot reload
make start             # Start production application
make build             # Build for production
make stop              # Stop all running processes
make logs              # Show application logs
```

### Development & Maintenance

```bash
make test              # Run tests
make lint              # Run linter
make format            # Format code
make clean             # Clean build artifacts
make deep-clean        # Deep clean including node_modules
```

### Utility Commands

```bash
make status            # Show current status
make check-csvs        # Check CSV files in summary_data
make debug-db          # Debug database connection
make check-ports       # Check port availability
make quick-start       # Quick start (assumes setup done)
```

### GeoNames API Integration

```bash
make geonames-update         # Update missing city data with GeoNames API
make geonames-update-force   # Force update ALL cities with missing data
make geonames-update-verbose # Update with detailed logging
make geonames-report         # Generate missing data report
make geonames-help           # Show GeoNames API help
```

### Examples

```bash
# Complete fresh setup
make full-pipeline

# Update data and restart
make db-aggregate && make dev

# Check what's available
make help

# Quick development restart
make stop && make dev
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

This will automatically run the postinstall script to copy Cesium assets to `/public/cesium`.

### 2. Setup Environment Variables

**Option A: Interactive Setup (Recommended)**
```bash
npm run setup
```
This will:
- Copy `env.example` to `.env.local`
- Prompt you to enter your Cesium Ion token
- Guide you through getting a token if needed

**Option B: Manual Setup**
```bash
npm run copy-env
```
Then manually edit `.env.local` and add your Cesium Ion token.

**Getting a Cesium Ion Token:**
1. Visit [https://ion.cesium.com/](https://ion.cesium.com/)
2. Sign up for a free account
3. Create a new token
4. Copy the token when prompted by the setup script

### 3. Setup Database

**Prerequisites:**
- PostgreSQL 12+ installed and running
- Database created (e.g., `pedx_visualizer`)

**Setup Database:**
1. Update your `.env.local` with database credentials:
   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/pedx_visualizer
   ```

2. Run the database setup script:
   ```bash
   npm run setup-db
   ```

This will:
- Create the `CoreGlobalCrossingData` table
- Set up `CityInsight` and `MetricInsight` views
- Insert sample data from 10 major cities

### 4. Aggregate CSV Data (Optional)

If you have CSV data files in the `summary_data` folder, you can aggregate them into the database:

**First Time Setup (Fresh Start):**
```bash
npm run aggregate-csv-fresh
```

**Incremental Updates (Default):**
```bash
npm run aggregate-csv
```

**With Verbose Logging:**
```bash
npm run aggregate-csv-verbose
```

The aggregation script will:
- Process all CSV files in the `summary_data` directory
- Create analytics dimensions and facts tables
- Handle incremental updates without duplicates
- Automatically update missing city data using GeoNames API
- Generate summary statistics

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Database Architecture

### Core Tables

#### CoreGlobalCrossingData Table
The main table stores raw pedestrian crossing data with the following key metrics:
- **Crossing Speed**: Average, median, min, max (m/s)
- **Time to Start**: Average, median, min, max (seconds)
- **Waiting Time**: Average, median (seconds)
- **Crossing Distance**: Average, median (meters)
- **Geographic Data**: Latitude, longitude coordinates
- **Metadata**: City, country, population, videos analyzed

#### Analytics Tables (New Structure)

##### analytics_dimensions
Metadata about analytical groupings:
- `name`: Logical group or CSV source (e.g., "gender_stats", "age_stats")
- `dimension`: Independent variable (e.g., "gender", "age", "weather")
- `target_metric`: Dependent metric (e.g., "risky_crossing_rate")
- `level`: Analysis level (global, continent, city, video)
- `description`: Optional description

##### analytics_facts
Actual measurements and values:
- `dimension_name`: Reference to analytics_dimensions.name
- `dimension_value`: Category value (e.g., "male", "bus", "rain")
- `target_metric`: Metric being measured
- `value`: Numeric value (percentage, rate, correlation)
- `context_city_id`: Optional city-specific analysis
- `context_video_id`: Optional video-specific analysis
- `extra`: JSONB for additional metrics and context

### Views

#### CityInsight View
Provides city-specific rankings and insights:
- Rankings for crossing speed and decision time
- Percentiles for comparative analysis
- Contextual insights (e.g., "Top 20% fastest crossing speeds")

#### MetricInsight View
Provides global metric summaries:
- **Top City**: Best performing city for each metric
- **Last City**: Worst performing city for each metric
- **Global Statistics**: Average and median values
- **Descriptions**: Human-readable metric explanations
- **Insights**: Cultural and infrastructure context

### Available Metrics
1. **crossing_speed**: Pedestrian walking speed during crossings
2. **time_to_start**: Decision time before starting to cross
3. **waiting_time**: Patience at crosswalks
4. **crossing_distance**: Street width measurements

### Analytics Views

#### analytics_summary
Complete analytics data with dimension metadata and city context.

#### analytics_global
Global-level analytics (no city/video context) for overall trends.

#### analytics_city
City-level analytics with geographic context.

#### analytics_cross_dimension
Cross-dimensional analysis (e.g., gender vs age comparisons).

## City Insights System

The PedX Visualizer includes an advanced **City Insights** generation system that automatically creates templated, data-driven insights for each city based on statistical analysis and relevance scoring.

> 📖 **For detailed implementation information, see [INSIGHTS_IMPLEMENTATION.md](./INSIGHTS_IMPLEMENTATION.md)**

### Overview

The insights system analyzes city-specific data against global baselines to generate meaningful, contextual insights. Each city receives between 3-10 insights, prioritized by relevance and statistical significance.

### Features

- **12+ Insight Templates**: Covering speed, behavior, demographics, weather, vehicles, and more
- **Relevance Scoring**: Insights are ranked by statistical significance and importance
- **Data Confidence Levels**: Each insight includes confidence indicators (high/medium/low)
- **Threshold-Based Filtering**: Only statistically significant insights are shown
- **Automatic Generation**: Updates with database refresh pipeline
- **Frontend Display**: Beautiful UI cards in the Info Sidebar

### Materialized Views

#### mv_city_insights
Pre-computed city-level data for fast insight generation:
- **Speed Metrics**: Average crossing speed, rankings, percentiles
- **Behavioral Metrics**: Risky crossing, red light violations, crosswalk usage
- **Demographics**: Age distribution, gender ratios, phone usage
- **Environmental**: Dominant weather, weather variety
- **Vehicles**: Top vehicle types by city
- **Continental Rankings**: City's rank within its continent

#### mv_global_insights
Global baseline data for comparative analysis:
- **Global Averages**: Crossing speed, risk rates, age, etc.
- **Global Medians**: Robust central tendency measures
- **Percentiles**: Q1, Q3 for outlier detection
- **Totals**: Cities, videos, pedestrians analyzed

### Insight Templates

The system includes 12 templated insights with intelligent relevance logic:

#### 1. Speed Comparison (speed_vs_global)
Compares city crossing speed to global average.
- **Show if**: `|delta| >= 10%` AND `video_count >= 3`
- **Example**: "Barcelona's average crossing speed is 2.1 m/s, 15% faster than the global average of 1.83 m/s"

#### 2. Speed Ranking (speed_ranking)
Shows city's global rank for crossing speed.
- **Show if**: `rank <= 5` OR `rank >= total_cities - 5`
- **Example**: "Barcelona ranks #3 out of 47 cities for crossing speed"

#### 3. Risk Assessment (risk_assessment)
Highlights risky crossing patterns.
- **Show if**: `|delta| >= 15%` AND `pedestrian_count >= 50`
- **Example**: "Barcelona has a 23.5% risky crossing rate, 18% higher than the global average"

#### 4. Weather Dominance (weather_dominance)
Identifies dominant weather conditions.
- **Show if**: Weather appears in `>= 40%` of videos OR low weather variety
- **Example**: "Sunny conditions are most common in Barcelona"

#### 5. Vehicle Composition (top_vehicles)
Shows most common vehicle types.
- **Show if**: `video_count >= 2`
- **Example**: "Most common vehicles in Barcelona: car, motorbike, bus"

#### 6. Age Demographics (age_demographics)
Compares average pedestrian age to global.
- **Show if**: `|delta| >= 20%` AND `pedestrian_count >= 30`
- **Example**: "Average pedestrian age in Barcelona is 32.4 years, 23% lower than the global median"

#### 7. Phone Usage (phone_usage)
Highlights phone usage while crossing.
- **Show if**: `usage >= 15%`
- **Example**: "18.3% of pedestrians in Barcelona use phones while crossing"

#### 8. Crosswalk Usage (crosswalk_usage)
Analyzes crosswalk usage patterns.
- **Show if**: `|delta| >= 25%` AND `pedestrian_count >= 40`
- **Example**: "Barcelona shows 67.8% crosswalk usage, 32% higher than the global average"

#### 9. Continental Leadership (continent_leader)
Identifies continent leaders.
- **Show if**: `continent_rank = 1`
- **Example**: "Barcelona has the fastest crossing speed in Europe"

#### 10. Gender Balance (gender_balance)
Shows gender distribution patterns.
- **Show if**: `|delta from 50%| >= 25%`
- **Example**: "62.3% of pedestrians in Barcelona are male, showing male-dominant crossing patterns"

#### 11. Red Light Violations (red_light_violations)
Highlights red light running behavior.
- **Show if**: `rate >= 10%` OR `rank <= 10`
- **Example**: "Barcelona has a 14.2% red light violation rate, ranking #7 globally"

#### 12. Data Confidence (data_confidence)
Shows sample size for transparency.
- **Always shown** (lowest priority)
- **Example**: "Based on analysis of 8 videos and 342 pedestrians"

### Usage

#### Generating Insights

```bash
# Generate insights for all cities
make db-generate-insights

# Generate with detailed logging
make db-generate-insights-verbose

# Test without updating database
make db-generate-insights-dry

# Automatic generation as part of pipeline
make db-pipeline  # Includes aggregation + refresh + insights
```

#### Refreshing Insights

```bash
# Refresh views and regenerate insights
make db-refresh-all

# Or as separate steps
make db-refresh-views
make db-generate-insights
```

#### Standalone Script

```bash
# Basic usage
node scripts/generate-city-insights.js

# With verbose logging
node scripts/generate-city-insights.js --verbose

# Dry run (test without updating)
node scripts/generate-city-insights.js --dry-run --verbose
```

### Data Structure

Insights are stored in the `cities` table as JSONB:

```json
{
  "insights": [
    {
      "id": "47_speed_vs_global",
      "category": "speed",
      "text": "Barcelona's average crossing speed is 2.1 m/s, 15% faster than global average",
      "relevance_score": 0.85,
      "data_confidence": "high",
      "metrics": {
        "city_value": 2.1,
        "comparison_value": 1.83,
        "delta_percent": 15.2
      }
    }
  ]
}
```

### Frontend Display

Insights are automatically displayed in the **Info Sidebar** when a city is selected:

- **Sorted by Relevance**: Most important insights shown first
- **Category Badges**: Visual indicators for insight type
- **Confidence Levels**: Color-coded confidence badges
- **Responsive Cards**: Beautiful, readable insight cards
- **Top 6 Display**: Shows the 6 most relevant insights

### Customization

#### Adding New Templates

Edit `/scripts/generate-city-insights.js` and add to `INSIGHT_TEMPLATES`:

```javascript
{
  id: 'your_insight_id',
  category: 'your_category',
  name: 'Template Name',
  evaluate: (cityData, globalData) => {
    // Your logic here
    if (/* conditions not met */) return null;
    
    return {
      text: "Your templated insight text",
      relevance_score: 0.7, // 0.0 to 1.0
      metrics: {
        city_value: someValue,
        comparison_value: globalValue,
        delta_percent: deltaPercent
      }
    };
  }
}
```

#### Adjusting Thresholds

Modify the conditions in each template's `evaluate` function:
- Change minimum sample sizes
- Adjust delta percentages
- Modify relevance score calculations

#### Changing Display Count

Edit `/src/components/info-sidebar.tsx`:
```tsx
.slice(0, 6)  // Change 6 to your desired number
```

### Performance

- **Materialized Views**: Pre-computed for fast generation
- **Batch Processing**: All cities processed in single script run
- **Minimal Overhead**: JSONB storage is efficient and indexed
- **On-Demand Updates**: Only regenerate when data changes

### Integration with Pipeline

The insights system is fully integrated into the database pipeline:

1. **CSV Aggregation** → Updates raw data
2. **View Refresh** → Recomputes mv_city_insights & mv_global_insights
3. **Insights Generation** → Creates templated insights from views
4. **Frontend Display** → Automatically shows new insights

Run the complete pipeline:
```bash
make db-pipeline
```

This ensures insights are always based on the latest data.

## API Endpoints

### Cities API
- `GET /api/cities` - Get city insights with filtering
- Query parameters: `city`, `country`, `limit`

### Metric Insights API
- `GET /api/insights/metrics` - Get metric insights
- Query parameters: `type` (metric_type), `limit`

### Metric Mode

The application includes a comprehensive **Metric Mode** feature that provides detailed analysis when a behavior metric is selected. This mode displays city rankings, correlations, and relationships for metrics like risky crossing rate, crosswalk usage, and more.

> 📖 **For detailed Metric Mode implementation, see [METRIC_MODE_IMPLEMENTATION.md](./METRIC_MODE_IMPLEMENTATION.md)**

### Raw Data API
- `GET /api/data` - Get raw crossing data
- `POST /api/data` - Insert new crossing data

## CSV Data Aggregation

The system supports aggregating CSV data from the `summary_data` folder into structured database tables.

> 📖 **For detailed aggregation documentation, see [AGGREGATION_README.md](./AGGREGATION_README.md)**

### Supported CSV Files

#### Core Data Files
- `all_video_info.csv` - Video metadata and aggregated metrics
- `all_time_info.csv` - Video timing data  
- `all_pedestrian_info.csv` - Individual pedestrian observations

#### Analytics Files
- `accident_road_condition_stats.csv` - Road condition impact analysis
- `age_stats.csv` - Pedestrian behavior by age group
- `gender_stats.csv` - Pedestrian behavior by gender
- `weather_daytime_stats.csv` - Weather and time of day analysis
- `clothing_stats.csv` - Clothing type behavior analysis
- `road_corr.csv` - Road metric correlations
- `crosswalk_coeff.csv` - Crosswalk usage coefficients
- And more...

### Aggregation Process

The aggregation script processes CSV files and creates:

1. **Dimensions**: Metadata about analytical groupings
2. **Facts**: Actual measurements with context
3. **Relationships**: Links between dimensions and facts
4. **Views**: Pre-computed queries for frontend consumption

### Example Queries

```sql
-- Get all gender statistics
SELECT * FROM analytics_global WHERE dimension_name = 'gender_stats';

-- Get risky crossing rates by age
SELECT dimension_value as age, value as risky_crossing_rate 
FROM analytics_facts 
WHERE dimension_name = 'age_stats' AND target_metric = 'risky_crossing_rate'
ORDER BY dimension_value::INTEGER;

-- Cross-dimensional analysis: gender vs age
SELECT * FROM analytics_cross_dimension 
WHERE target_metric = 'risky_crossing_rate' 
  AND dimension1_name = 'gender_stats' 
  AND dimension2_name = 'age_stats';
```

### Key Features

- **Incremental Updates**: Add new data without creating duplicates
- **Conflict Resolution**: Uses PostgreSQL `ON CONFLICT` clauses
- **Data Validation**: Safe parsing of numeric, boolean, and string values
- **Caching**: Efficient lookups for dimensions and facts
- **Error Handling**: Continues processing even if individual records fail
- **Flexible Schema**: Easy to add new CSV files and metrics

## Project Structure

```
pedx-visualizer/
├── src/
│   ├── app/
│   │   ├── api/              # RESTful API endpoints
│   │   │   ├── cities/
│   │   │   ├── insights/
│   │   │   └── data/
│   │   ├── page.tsx          # Main page with sidebars over globe
│   │   └── globals.css       # Global styles
│   ├── components/
│   │   ├── Globe.tsx         # Cesium globe component
│   │   └── ui/               # shadcn/ui components
│   ├── lib/
│   │   ├── database.ts       # PostgreSQL connection
│   │   └── utils.ts          # Utility functions
│   └── types/
│       └── database.ts       # TypeScript interfaces
├── database/
│   ├── schema.sql            # Database schema and views
│   └── sample_data.sql       # Sample city data
├── public/
│   └── cesium/               # Cesium static assets (auto-generated)
├── scripts/
│   ├── copy-cesium-assets.js # Postinstall script
│   ├── setup-database.js     # Database setup script
│   └── aggregate-csv-data.js # CSV data aggregation script
├── summary_data/             # CSV data files for aggregation
├── next.config.mjs           # Next.js configuration for Cesium
└── package.json             # Dependencies and scripts
```

## Architecture

- **Globe Component**: Client-side Cesium integration with proper cleanup
- **Sidebars**: Floating UI panels for filters and information
- **Database Layer**: PostgreSQL with pre-computed insights for performance
- **API Layer**: RESTful endpoints with TypeScript interfaces
- **Static Assets**: Cesium assets served from `/public/cesium`
- **Webpack Configuration**: Automatic copying of Cesium Workers

## GeoNames API Integration

The system includes automatic city data completion using the GeoNames API to fill missing location information.

### Features

- **Automatic Data Completion**: Fills missing country, coordinates, continent data
- **Smart Matching**: Uses similarity algorithms to find the best city match
- **Rate Limiting**: Respects GeoNames API limits (1 request/second)
- **Comprehensive Reporting**: Detailed reports on what data was updated
- **Integration**: Runs automatically during CSV aggregation

### Setup

1. **Get GeoNames Username** (Free):
   - Visit [https://www.geonames.org/login](https://www.geonames.org/login)
   - Create a free account
   - Add your username to `.env`:
   ```
   GEONAMES_USERNAME=your_username_here
   ```

2. **Usage**:
   ```bash
   # Update missing city data
   make geonames-update
   
   # Force update ALL cities (including those with only optional data missing)
   make geonames-update-force
   
   # Update with detailed logging
   make geonames-update-verbose
   
   # Generate missing data report
   make geonames-report
   
   # Run as part of aggregation
   make db-aggregate  # Includes GeoNames update
   ```

### Data Updated

The system automatically fills missing:
- **Country**: Full country name
- **State/Province**: Administrative division
- **ISO3 Code**: Three-letter country code
- **Continent**: Geographic continent
- **Coordinates**: Latitude and longitude (critical for map display)
- **Population**: City population (when available)

### Reports

The system generates detailed reports showing:
- Cities successfully updated
- Cities that failed to match
- Cities skipped (only optional data missing)
- Missing data patterns across all cities

## Future Enhancements

This project is designed to be extended with:

- **Real-time Data**: Connect to live pedestrian crossing data sources
- **Advanced Visualizations**: Add charts and graphs to sidebars
- **Interactive Globe**: Click cities to show detailed insights
- **Data Export**: Implement CSV/JSON export functionality
- **User Authentication**: Add user management and data access control
- **More Metrics**: Add additional pedestrian behavior metrics
- **Additional APIs**: Integrate with other geographic/demographic data sources

## Development Notes

- The Cesium globe is configured with `requestRenderMode=true` for better performance
- Static assets are automatically copied during `npm install`
- The project uses Next.js App Router with TypeScript
- All UI components are from shadcn/ui for consistency
- Database views are automatically computed for real-time insights
- API endpoints provide both raw data and pre-computed insights

## Troubleshooting

If you encounter issues:

1. **Cesium not loading**: 
   - Check that your `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set correctly in `.env.local`
   - Verify the token is valid at [https://ion.cesium.com/](https://ion.cesium.com/)

2. **Database connection issues**:
   - Ensure PostgreSQL is running and accessible
   - Check that `DATABASE_URL` in `.env.local` is correct
   - Run `npm run setup-db` to create tables and sample data
   - Verify database exists: `createdb pedx_visualizer`

3. **API errors**:
   - Check database connection and table existence
   - Verify sample data was inserted correctly
   - Test API endpoints directly: `/api/cities`, `/api/insights/metrics`

4. **Assets not found**: 
   - Run `npm install` again to trigger the postinstall script
   - Check that `/public/cesium` directory exists with assets

5. **Build errors**: 
   - Ensure all dependencies are installed with `npm install`
   - Check that `.env.local` exists (run `npm run copy-env` if missing)

6. **Environment setup issues**:
   - Run `npm run setup` for interactive setup
   - Or manually copy `env.example` to `.env.local` and edit it

## Sample Data

The database includes sample data from 10 major cities:
- Tokyo, New York City, Copenhagen, Amsterdam
- Barcelona, Singapore, Berlin, Melbourne
- Stockholm, Vienna

Each city has realistic pedestrian crossing metrics based on urban planning research and cultural behaviors.

## Future Plans

### Video Coordinates

The video coordinate system allows individual videos to have their own geographic coordinates, separate from city-level coordinates. This enables precise visualization of video locations on the globe when a city is selected.

#### Implementation

The feature was implemented with the following components:

1. **Database Schema**: Added `latitude` and `longitude` columns to the `videos` table, allowing optional coordinate storage per video.

2. **Migration Script**: Created `scripts/migrate-add-video-coordinates.sql` to add the columns and populate mock data for testing.

3. **API Updates**: Enhanced `/api/cities/[city]/videos` endpoint to return video coordinates along with city fallback coordinates.

4. **Globe Visualization**: Updated the Globe component to:
   - Fetch videos when a city is selected
   - Display video coordinates as blue square markers (distinct from circular city markers)
   - Fall back to city coordinates if video coordinates are unavailable
   - Show video information on hover

5. **Mock Data Generation**: Created `scripts/add-mock-video-coordinates.js` to generate test coordinates within a small radius of each city center.

#### Usage for Future Engineers

**Setting Up Video Coordinates:**

1. Run the migration to add coordinate columns:
   ```bash
   make db-migrate-video-coordinates
   ```

2. Add coordinates to videos (either real or mock data):
   ```bash
   make db-add-mock-video-coordinates
   ```

3. Or manually update video coordinates in the database:
   ```sql
   UPDATE videos 
   SET latitude = 40.7128, longitude = -74.0060 
   WHERE id = 1;
   ```

**How It Works:**

- When a city is selected, the Globe component fetches all videos for that city via `/api/cities/[city]/videos`
- Videos with coordinates (either video-specific or city fallback) are displayed as blue square markers
- The system gracefully handles missing coordinates by falling back to city coordinates
- Video markers are automatically cleared when no city is selected

**Extending the Feature:**

- **Real Coordinate Data**: Replace mock data with actual GPS coordinates from video metadata
- **Video Clustering**: Implement marker clustering for cities with many videos
- **Video Selection**: Add click handlers to select and display video details
- **Coordinate Validation**: Add validation to ensure coordinates are within city boundaries
- **Batch Import**: Create scripts to import coordinates from external data sources

For detailed setup instructions, see [VIDEO_COORDINATES_SETUP.md](./VIDEO_COORDINATES_SETUP.md).