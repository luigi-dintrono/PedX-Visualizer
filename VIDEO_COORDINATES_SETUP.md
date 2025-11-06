# Video Coordinates Setup Guide

This guide explains how to set up video coordinates in the database and display them on the Globe.

## Quick Start

1. **Run the migration** to add coordinate columns to the videos table:
   ```bash
   make db-migrate-video-coordinates
   ```

2. **Add mock coordinate data** to existing videos:
   ```bash
   make db-add-mock-video-coordinates
   ```

3. **Restart your development server** if it's running:
   ```bash
   make dev
   ```

4. **Select a city** in the UI - you should now see blue square markers for videos!

## What Was Changed

### Database Schema
- Added `latitude` and `longitude` columns to the `videos` table
- Added geographic index for efficient queries
- Updated `v_video_summary` view to include coordinates

### API Updates
- `/api/cities/[city]/videos` now returns video coordinates
- Falls back to city coordinates if video coordinates are not available
- Properly converts PostgreSQL DECIMAL types to JavaScript numbers

### Globe Component
- Fetches videos when a city is selected
- Displays video coordinates as **blue square markers** (different from circular city markers)
- Shows video name and link on hover
- Falls back to city coordinates if video coordinates are missing

## Visual Differentiation

- **City markers**: Circular dots with colored centers (based on metric values)
- **Video markers**: Blue square markers with white centers and blue dots

## Debugging

If videos don't appear:

1. **Check the browser console** - Look for `[Globe]` prefixed messages:
   - `[Globe] Fetched videos for [city name]` - Shows API response
   - `[Globe] Videos with coordinates: X/Y` - Shows how many videos have coordinates
   - `[Globe] Creating markers for X videos` - Shows marker creation

2. **Verify database** - Check if videos have coordinates:
   ```sql
   SELECT 
     c.city,
     COUNT(*) as total_videos,
     COUNT(v.latitude) FILTER (WHERE v.latitude IS NOT NULL) as videos_with_coords
   FROM cities c
   LEFT JOIN videos v ON c.id = v.city_id
   GROUP BY c.id, c.city
   HAVING COUNT(*) > 0
   ORDER BY total_videos DESC
   LIMIT 10;
   ```

3. **Test the API** directly:
   ```bash
   curl http://localhost:3000/api/cities/[CITY_NAME]/videos?limit=10
   ```

## Manual SQL Migration

If you prefer to run the migration manually:

```bash
psql $DATABASE_URL -f scripts/migrate-add-video-coordinates.sql
```

## Adding More Mock Data

To regenerate mock coordinates for all videos:

```bash
# First, clear existing coordinates (optional)
psql $DATABASE_URL -c "UPDATE videos SET latitude = NULL, longitude = NULL;"

# Then add new mock data
make db-add-mock-video-coordinates
```

## Notes

- Mock coordinates are generated within ~5.5km radius of each city center
- Videos without coordinates will fall back to city coordinates
- The Globe will only show video markers when a city is selected
- Video markers are cleared when no city is selected

