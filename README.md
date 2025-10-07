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
make db-setup          # Initialize database schema
make db-reset          # Reset database (destructive!)
make db-aggregate      # Aggregate CSV data into database
make db-refresh-views  # Refresh materialized views
make db-pipeline       # Complete database update (aggregate + refresh)
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

## API Endpoints

### Cities API
- `GET /api/cities` - Get city insights with filtering
- Query parameters: `city`, `country`, `limit`

### Metric Insights API
- `GET /api/insights/metrics` - Get metric insights
- Query parameters: `type` (metric_type), `limit`

### Raw Data API
- `GET /api/data` - Get raw crossing data
- `POST /api/data` - Insert new crossing data

## CSV Data Aggregation

The system supports aggregating CSV data from the `summary_data` folder into structured database tables.

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

## Future Enhancements

This project is designed to be extended with:

- **Real-time Data**: Connect to live pedestrian crossing data sources
- **Advanced Visualizations**: Add charts and graphs to sidebars
- **Interactive Globe**: Click cities to show detailed insights
- **Data Export**: Implement CSV/JSON export functionality
- **User Authentication**: Add user management and data access control
- **More Metrics**: Add additional pedestrian behavior metrics

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