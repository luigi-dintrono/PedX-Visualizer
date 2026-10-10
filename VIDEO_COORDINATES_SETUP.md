# Video Coordinates Setup Guide

This guide explains how to set up video coordinates in the database and display them on the Globe.

## Real coordinates from PedX-Insight localization (recommended)

PedX-Insight can estimate WHERE each video was filmed directly from the footage
(via its vendored Monocular-OSM-Localization tool) — no GPS needed. That replaces
the mock coordinates below with real per-video positions, plus street name and a
confidence level shown on the Globe marker hover.

1. **In PedX-Insight** (sibling repo), localize the videos and aggregate:
   ```bash
   python main.py --mode localize --source_video_path PATH/TO/VIDEO --city "City, Country"
   # or batch: python run.py --localize
   python get_all_video_locations.py   # -> summary_data/all_video_locations.csv
   ```
2. **Migrate the database once** (adds street_name / localization_confidence / localization_status):
   ```bash
   make db-migrate-localization-fields
   ```
3. **Import the real coordinates** (overwrites mock coordinates for localized videos):
   ```bash
   node scripts/import-video-coordinates.js --csv ../PedX-Insight/summary_data/all_video_locations.csv
   # or copy the CSV into ./summary_data/ and: make db-import-video-coordinates
   # dry run first: npm run import-video-coordinates-dry
   ```
4. Restart the dev server and select the city — the video markers move to their
   real estimated positions; hover shows street + confidence.

`npm run db:publish` (and `make db-pipeline`) run the import automatically when
`summary_data/all_video_locations.csv` is present. The old mock-coordinate script was removed
(2026-10-10): it wrote random positions into the live database, which were then displayed as if
they were localisation results. Videos that have not been localized simply have no marker position.

## Notes

- Mock coordinates are generated within ~5.5km radius of each city center
- Videos without coordinates will fall back to city coordinates
- The Globe will only show video markers when a city is selected
- Video markers are cleared when no city is selected

