# PedX Visualizer

A minimal Next.js application with CesiumJS integration for 3D globe visualization and data analysis.

## Validated dataset releases

The interface uses one active dataset release and one shared cohort definition for
maps, metric cards, comparisons, rankings and generated insights. Rates remain
fractions in storage/API responses and convert to percentages once for display.
Each rate counts its own known outcomes; missing observations are never negative flags.
Imported crossing speed/time are reference data and cannot generate measured rankings.

Default comparisons require completed analysis, verified filming-city evidence and
validated measurements. Experimental opt-in broadens measurement validity only; it
does not bypass location verification or admit known-invalid classifiers. Coverage
and release status explain empty samples. Recording dates and analysis timestamps
are separate; processing-history charts do not describe behavioral change.

Apply versioned migrations to an existing database before deploying this version:

```bash
npm run db:migrate
```

Prepare a fresh release in PedX-Insight with `python -m scripts.build_release --output
NEW_DIRECTORY`, then validate and activate it from this repository:

```bash
npm run db:publish -- --csv-dir PATH/TO/RELEASE --validate-only
npm run db:publish -- --csv-dir PATH/TO/RELEASE
```

Checksums, headers, row counts and population provenance are verified before database
access. One transaction replaces pedestrian records, imports coordinates/statistics,
refreshes views/insights and activates the release. Failure retains the previous active
dataset. A private validated file snapshot prevents concurrent CSV modifications.
`make db-pipeline` and `make db-aggregate PEDX_CSV_DIR=PATH/TO/RELEASE` use this publisher.
Legacy audit exports cannot activate as production releases.

New releases clear previous model intervals. Fit them separately with
`npm run model:rates -- --dataset-release-id RELEASE_ID`. The UI reports intervals
unavailable until a fit matches the active release and current denominators.

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Tests include
isolated PostgreSQL execution with PGlite and transaction rollback cases, without a
production database.

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

Generated sentences share the same pooled known-flag estimator as the map and
city cards. Results include their eligible sample size and describe the observed
clips, not a representative city survey. Reference speed constants, unverified
locations and invalid classifiers cannot produce observational rankings.

`generate-city-insights.js` replaces each city's insight list so removed data cannot
leave stale headlines. Publication runs it inside the dataset activation transaction.
Filtered insights use the same cohort as the visualization.

Relationship cards read the active release's `dataset_statistics` snapshot. True
zeroes, original age bands, sample sizes, city counts, confidence intervals and
FDR q-values are retained. Global relationships are unavailable for filtered cohorts
until matching statistics exist. Association text does not imply causation.

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

**Implementation**

The feature was implemented with the following components:

1. **Database Schema**: Added `latitude` and `longitude` columns to the `videos` table, allowing optional coordinate storage per video.

2. **Migration Script**: Created `scripts/migrate-add-video-coordinates.sql` to add the columns and populate mock data for testing.

3. **API Updates**: Enhanced `/api/cities/[city]/videos` endpoint to return video coordinates along with city fallback coordinates.

4. **Globe Visualization**: Updated the Globe component to:
   - Fetch videos when a city is selected
   - Display video coordinates as blue square markers (distinct from circular city markers)
   - Fall back to city coordinates if video coordinates are unavailable
   - Show video information on hover

5. **Mock Data Generation**: The mock-coordinate script was removed (2026-10-10): real localized positions come from `summary_data/all_video_locations.csv` via `npm run db:publish`.

#### Usage for Future Engineers

**Setting Up Video Coordinates:**

1. Run the migration to add coordinate columns:
   ```bash
   make db-migrate-video-coordinates
   ```

2. Import the localized video coordinates:
   ```bash
   npm run import-video-coordinates
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

For detailed setup instructions, see [VIDEO_COORDINATES_SETUP.md](./VIDEO_COORDINATES_SETUP.md).

### Analysis history and recording dates

The active release is an immutable snapshot, not a reconstruction of past behavior.
Temporal charts group explicit analysis timestamps and label results as processing
history. Filming dates are not inferred from imports, file modification times,
upload dates or processing timestamps. Unknown recording dates remain missing.
Preserve `recorded_at` and `recording_date_source` when genuine recording evidence
is available for future recording-time analyses.

City selectors and APIs use database city IDs. External identities preserve country
and administrative subdivisions; ambiguous name-only lookups return a conflict.
Comparisons use the same active release, metric policy and cohort parameters as
all other displays.
