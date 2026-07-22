'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useFilter } from '@/contexts/FilterContext';
import { CityGlobeData, CityVideo } from '@/types/database';
import type * as Cesium from 'cesium';

declare global {
  interface Window {
    CESIUM_BASE_URL: string;
    Cesium?: typeof import('cesium');
  }
}

// Load the prebuilt Cesium bundle (public/cesium/Cesium.js, copied from
// node_modules by scripts/copy-cesium-assets.js) via a <script> tag instead of
// `import('cesium')`. Bundlers repeatedly break on Cesium's module graph — the
// 1.143 dynamic import hangs forever under Turbopack and chunk-errors under
// webpack — so we bypass bundling entirely: the npm package supplies only the
// TypeScript types and the copied static assets. widgets.css is injected as a
// <link> for the same reason.
let cesiumLoadPromise: Promise<typeof import('cesium')> | null = null;

function loadCesium(): Promise<typeof import('cesium')> {
  if (cesiumLoadPromise) return cesiumLoadPromise;
  cesiumLoadPromise = new Promise((resolve, reject) => {
    if (window.Cesium) {
      resolve(window.Cesium);
      return;
    }

    const base = process.env.NEXT_PUBLIC_CESIUM_BASE_URL || '/cesium/';
    const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
    // Must be set before Cesium.js executes so it can locate Workers/Assets.
    window.CESIUM_BASE_URL = baseWithSlash;

    if (!document.querySelector('link[data-cesium-widgets-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${baseWithSlash}Widgets/widgets.css`;
      link.setAttribute('data-cesium-widgets-css', 'true');
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = `${baseWithSlash}Cesium.js`;
    script.async = true;
    script.onload = () => {
      if (window.Cesium) {
        resolve(window.Cesium);
      } else {
        cesiumLoadPromise = null;
        reject(new Error('Cesium.js loaded but window.Cesium is undefined'));
      }
    };
    script.onerror = () => {
      cesiumLoadPromise = null;
      script.remove();
      reject(new Error(`Failed to load ${baseWithSlash}Cesium.js`));
    };
    document.head.appendChild(script);
  });
  return cesiumLoadPromise;
}

// Metric configuration for easy extensibility
const METRIC_CONFIG = {
  risky_crossing: {
    property: 'risky_crossing_rate',
    name: 'Risky Crossing Rate',
    unit: '%',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low risk (RGBA)
      max: [1, 0, 0, 0.8], // Red for high risk (RGBA)
    },
  },
  run_red_light: {
    property: 'run_red_light_rate',
    name: 'Run Red Light Rate',
    unit: '%',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low rate
      max: [1, 0, 0, 0.8], // Red for high rate
    },
  },
  crosswalk_usage: {
    property: 'crosswalk_usage_rate',
    name: 'Crosswalk Usage Rate',
    unit: '%',
    colorScale: {
      min: [1, 0, 0, 0.6], // Red for low usage
      max: [0, 1, 0, 0.8], // Green for high usage
    },
  },
  phone_usage: {
    property: 'phone_usage_rate',
    name: 'Phone Usage While Crossing',
    unit: '%',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low usage
      max: [1, 0, 0, 0.8], // Red for high usage (dangerous)
    },
  },
  crossing_speed: {
    property: 'avg_crossing_speed',
    name: 'Average Crossing Speed',
    unit: 'm/s',
    colorScale: {
      min: [1, 0, 0, 0.6], // Red for slow (dangerous)
      max: [0, 1, 0, 0.8], // Green for fast (safer)
    },
  },
  measured_walking_speed: {
    // MEASURED from dense video tracking (PedX-Insight), not the imported city
    // constant behind crossing_speed. Sparse: cities without measured videos
    // have NULL and are simply not painted (no fake zeros).
    property: 'avg_measured_walking_speed',
    name: 'Measured Walking Speed',
    unit: 'm/s',
    colorScale: {
      min: [1, 0, 0, 0.6], // Red for slow (dangerous)
      max: [0, 1, 0, 0.8], // Green for fast (safer)
    },
  },
  crossing_time: {
    property: 'avg_crossing_time',
    name: 'Average Crossing Time',
    unit: 'seconds',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for short time (safer)
      max: [1, 0, 0, 0.8], // Red for long time (more exposure)
    },
  },
  avg_age: {
    property: 'avg_pedestrian_age',
    name: 'Average Pedestrian Age',
    unit: 'years',
    colorScale: {
      min: [0.2, 0.6, 1, 0.6], // Blue for young
      max: [1, 0.6, 0.2, 0.8], // Orange for elderly
    },
  },
  pedestrian_density: {
    property: 'avg_pedestrians_per_video',
    name: 'Pedestrian Density',
    unit: 'pedestrians',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low density
      max: [1, 0.6, 0, 0.8], // Orange for high density
    },
  },
  road_width: {
    property: 'avg_road_width',
    name: 'Average Road Width',
    unit: 'meters',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for narrow (safer)
      max: [1, 0, 0, 0.8], // Red for wide (more dangerous)
    },
  },
  traffic_mortality: {
    property: 'traffic_mortality',
    name: 'Traffic Mortality',
    unit: 'per 100k',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low mortality
      max: [1, 0, 0, 0.8], // Red for high mortality
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Canvas caches. The heatmap used to allocate a fresh 256×256 gradient canvas +
// 20×20 dot canvas PER CITY on EVERY repaint (~1,200 canvases + ~600 GPU texture
// uploads each filter/metric change). Colors are quantized to 32 levels per
// channel so cities with near-identical colors share one canvas/texture, and the
// caches persist across repaints. Bounded: ≤32⁴ keys in theory, ~dozens in practice.
const CANVAS_COLOR_LEVELS = 32;

function quantizeColorKey(color: any): string {
  const q = (c: number) =>
    Math.round(Math.max(0, Math.min(1, isNaN(c) ? 0 : c)) * (CANVAS_COLOR_LEVELS - 1));
  return `${q(color?.red ?? 0)}-${q(color?.green ?? 0)}-${q(color?.blue ?? 0)}-${q(color?.alpha ?? 0.5)}`;
}

const gradientCanvasCache = new Map<string, HTMLCanvasElement>();
function getGradientCanvas(color: any): HTMLCanvasElement {
  const key = quantizeColorKey(color);
  let canvas = gradientCanvasCache.get(key);
  if (!canvas) {
    canvas = createRadialGradientCanvas(color);
    gradientCanvasCache.set(key, canvas);
  }
  return canvas;
}

const dotCanvasCache = new Map<string, HTMLCanvasElement>();
function getDotCanvas(color: any): HTMLCanvasElement {
  const key = quantizeColorKey(color);
  let canvas = dotCanvasCache.get(key);
  if (!canvas) {
    canvas = createDotCanvas(color);
    dotCanvasCache.set(key, canvas);
  }
  return canvas;
}

// Helper function to create radial gradient canvas for heatmap effect
function createRadialGradientCanvas(color: any): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return canvas;
  
  // Extract RGBA values from Cesium.Color with validation
  const red = color?.red ?? 0;
  const green = color?.green ?? 0;
  const blue = color?.blue ?? 0;
  const alpha = color?.alpha ?? 0.5;
  
  // Validate and clamp values to prevent NaN
  const r = Math.floor(Math.max(0, Math.min(255, (isNaN(red) ? 0 : red) * 255)));
  const g = Math.floor(Math.max(0, Math.min(255, (isNaN(green) ? 0 : green) * 255)));
  const b = Math.floor(Math.max(0, Math.min(255, (isNaN(blue) ? 0 : blue) * 255)));
  const a = Math.max(0, Math.min(1, isNaN(alpha) ? 0.5 : alpha));
  
  // Create radial gradient from center to edge
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  
  // Center: full opacity
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a})`);
  // Mid: medium opacity
  gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${a * 0.5})`);
  // Edge: fade to transparent
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  
  return canvas;
}

// Helper for a small circular dot sprite with white outline
function createDotCanvas(color: any): HTMLCanvasElement {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const r = Math.floor(color.red * 255);
  const g = Math.floor(color.green * 255);
  const b = Math.floor(color.blue * 255);

  // Outer white outline
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();

  // Inner colored circle
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
  ctx.fill();

  return canvas;
}

// Helper for video dot - smaller and different style (square with border)
function createVideoDotCanvas(): HTMLCanvasElement {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Outer border (blue)
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(0, 0, size, size);

  // Inner square (white)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2, 2, size - 4, size - 4);

  // Center dot (blue)
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

// Helper for a localization CANDIDATE dot (smaller, amber circle) — the alternatives the
// monocular-OSM localization considered before settling on the chosen (rank-1) point.
function createCandidateDotCanvas(): HTMLCanvasElement {
  const size = 12;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#f59e0b'; // amber
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  return canvas;
}

// Video rows come from FilterContext.cityVideos (shared fetch with InfoSidebar).
type VideoData = CityVideo;

export default function Globe() {
  const cesiumContainer = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const dataSourceRef = useRef<Cesium.DataSource | null>(null);
  const videoDataSourceRef = useRef<Cesium.DataSource | null>(null);
  // Holds the hover/click handler registered by createHeatmap so it can be
  // destroyed before a new one is created (otherwise handlers leak and stack).
  const heatmapHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  // Entity whose label is currently shown on hover. Lets the mousemove handler toggle
  // exactly two labels (previous off, new on) instead of scanning all ~600 entities and
  // writing label.show on each — that scan ran ~60×/s and invalidated the scene constantly.
  const hoveredEntityRef = useRef<Cesium.Entity | null>(null);
  // Refs mirroring the latest values used by the one-time init effect's
  // morphComplete listener, so it rebuilds with current (not stale) state.
  const selectedMetricsRef = useRef<string[]>([]);
  const fetchGlobalDataRef = useRef<(() => Promise<CityGlobeData[]>) | null>(null);
  const createHeatmapRef = useRef<
    | ((
        data: CityGlobeData[],
        metricType: string,
        Cesium: typeof import('cesium'),
        onCityClick?: (cityName: string) => void
      ) => Promise<void>)
    | null
  >(null);
  
  const {
    selectedCity,
    selectedMetrics,
    granularFilters,
    filteredCityData,
    cityData,
    cityVideos,
    setSelectedCity,
  } = useFilter();

  // /api/data response cache + in-flight abort. The response is metric-agnostic (it
  // carries ALL paintable columns), so switching the selected metric repaints from this
  // cache with zero network; only real filter changes refetch. The AbortController
  // cancels a superseded in-flight request instead of letting it complete server-side.
  const globalDataCacheRef = useRef<{ key: string; data: CityGlobeData[] } | null>(null);
  const globalDataAbortRef = useRef<AbortController | null>(null);

  // Create a stable reference for vehicle filters to ensure useEffect detects changes
  // Convert arrays to strings for reliable change detection
  const vehicleFiltersKey = useMemo(() => 
    JSON.stringify({
      car: granularFilters.car,
      bus: granularFilters.bus,
      truck: granularFilters.truck,
      motorbike: granularFilters.motorbike,
      bicycle: granularFilters.bicycle,
    }), 
    [
      granularFilters.car[0],
      granularFilters.car[1],
      granularFilters.bus[0],
      granularFilters.bus[1],
      granularFilters.truck[0],
      granularFilters.truck[1],
      granularFilters.motorbike[0],
      granularFilters.motorbike[1],
      granularFilters.bicycle[0],
      granularFilters.bicycle[1],
    ]
  );

  // Create a stable reference for clothing & accessories filters to ensure useEffect detects changes
  const clothingFiltersKey = useMemo(() => 
    JSON.stringify({
      phoneUse: granularFilters.phoneUse,
      backpack: granularFilters.backpack,
      umbrella: granularFilters.umbrella,
      handbag: granularFilters.handbag,
      suitcase: granularFilters.suitcase,
      shirtType: granularFilters.shirtType,
      bottomWear: granularFilters.bottomWear,
    }), 
    [
      granularFilters.phoneUse,
      granularFilters.backpack,
      granularFilters.umbrella,
      granularFilters.handbag,
      granularFilters.suitcase,
      granularFilters.shirtType.join(','),
      granularFilters.bottomWear.join(','),
    ]
  );

  // (City videos now come from FilterContext.cityVideos — one shared, abortable fetch.)

  // Fetch global data for heatmap with filters
  const fetchGlobalData = useCallback(async (): Promise<CityGlobeData[]> => {
    try {
      // Build query parameters from granular filters
      const params = new URLSearchParams();
      
      // Array filters
      if (granularFilters.continents.length > 0) {
        params.append('continents', granularFilters.continents.join(','));
      }
      
      if (granularFilters.weather.length > 0) {
        params.append('weather', granularFilters.weather.join(','));
      }

      if (granularFilters.gender.length > 0) {
        params.append('gender', granularFilters.gender.join(','));
      }

      if (granularFilters.shirtType.length > 0) {
        params.append('shirtType', granularFilters.shirtType.join(','));
      }

      if (granularFilters.bottomWear.length > 0) {
        params.append('bottomWear', granularFilters.bottomWear.join(','));
      }
      
      // Population range (only if not default)
      if (granularFilters.population[0] > 0) {
        params.append('minPopulation', granularFilters.population[0].toString());
      }
      if (granularFilters.population[1] < 50000000) {
        params.append('maxPopulation', granularFilters.population[1].toString());
      }
      
      // Age range (only if not default)
      if (granularFilters.ageRange[0] > 0) {
        params.append('minAge', granularFilters.ageRange[0].toString());
      }
      if (granularFilters.ageRange[1] < 100) {
        params.append('maxAge', granularFilters.ageRange[1].toString());
      }

      // Crossing speed range
      if (granularFilters.crossingSpeed[0] > 0) {
        params.append('minCrossingSpeed', granularFilters.crossingSpeed[0].toString());
      }
      if (granularFilters.crossingSpeed[1] < 5) {
        params.append('maxCrossingSpeed', granularFilters.crossingSpeed[1].toString());
      }

      // Road width range
      if (granularFilters.avgRoadWidth[0] > 0) {
        params.append('minRoadWidth', granularFilters.avgRoadWidth[0].toString());
      }
      if (granularFilters.avgRoadWidth[1] < 50) {
        params.append('maxRoadWidth', granularFilters.avgRoadWidth[1].toString());
      }

      // Boolean filters (Pedestrian Behavior)
      if (granularFilters.riskyCrossing === true) {
        params.append('riskyCrossing', 'true');
      }
      if (granularFilters.runRedLight === true) {
        params.append('runRedLight', 'true');
      }
      if (granularFilters.crosswalkUse === true) {
        params.append('crosswalkUse', 'true');
      }

      // Clothing & Accessories
      if (granularFilters.phoneUse === true) {
        params.append('phoneUse', 'true');
      }
      if (granularFilters.backpack === true) {
        params.append('backpack', 'true');
      }
      if (granularFilters.umbrella === true) {
        params.append('umbrella', 'true');
      }
      if (granularFilters.handbag === true) {
        params.append('handbag', 'true');
      }
      if (granularFilters.suitcase === true) {
        params.append('suitcase', 'true');
      }

      // Vehicle count filters — only sent when the user actually narrowed a range.
      // Sending them unconditionally forced /api/data onto its expensive
      // cities×videos×pedestrians CTE path on EVERY heatmap repaint, even with all
      // sliders at their defaults; omitting default ranges lets the API use the cheap
      // v_city_summary path. Ranges must match DEFAULT ranges in FilterContext.tsx.
      const vehicleDefaults: Record<string, [number, number]> = {
        Car: [0, 500],
        Bus: [0, 100],
        Truck: [0, 100],
        Motorbike: [0, 200],
        Bicycle: [0, 300],
      };
      const vehicleValues: Record<string, [number, number]> = {
        Car: granularFilters.car,
        Bus: granularFilters.bus,
        Truck: granularFilters.truck,
        Motorbike: granularFilters.motorbike,
        Bicycle: granularFilters.bicycle,
      };
      for (const [name, [min, max]] of Object.entries(vehicleValues)) {
        const [defMin, defMax] = vehicleDefaults[name];
        if (min !== defMin || max !== defMax) {
          params.append(`min${name}`, min.toString());
          params.append(`max${name}`, max.toString());
        }
      }


      // Add limit parameter to fetch more cities (increased from default 100)
      params.append('limit', '1000');

      const queryString = params.toString();
      const url = `/api/data?${queryString}`;

      // Same filter set as the last successful fetch → repaint from cache (this is
      // every metric switch, since the response carries all paintable columns).
      if (globalDataCacheRef.current?.key === queryString) {
        return globalDataCacheRef.current.data;
      }

      // Cancel a superseded in-flight request before starting the new one.
      globalDataAbortRef.current?.abort();
      const ctrl = new AbortController();
      globalDataAbortRef.current = ctrl;

      const response = await fetch(url, { signal: ctrl.signal });
      const result = await response.json();
      if (result.success) {
        globalDataCacheRef.current = { key: queryString, data: result.data };
        return result.data;
      }
      return [];
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Error fetching global data:', error);
      }
      return [];
    }
  }, [
    granularFilters,
    granularFilters.car,
    granularFilters.bus,
    granularFilters.truck,
    granularFilters.motorbike,
    granularFilters.bicycle,
    granularFilters.phoneUse,
    granularFilters.backpack,
    granularFilters.umbrella,
    granularFilters.handbag,
    granularFilters.suitcase,
    granularFilters.shirtType.length,
    granularFilters.shirtType[0],
    granularFilters.shirtType[1],
    granularFilters.shirtType[2],
    granularFilters.bottomWear.length,
    granularFilters.bottomWear[0],
    granularFilters.bottomWear[1],
    granularFilters.bottomWear[2],
  ]);

  // Scene mode controls
  const morphTo2D = useCallback(async () => {
    if (!viewerRef.current) return;
    await loadCesium();
    viewerRef.current.scene.morphTo2D(0.8);
  }, []);

  const morphTo3D = useCallback(async () => {
    if (!viewerRef.current) return;
    await loadCesium();
    viewerRef.current.scene.morphTo3D(0.8);
  }, []);

  // Get color for metric value
  const getColorForMetric = useCallback((
    value: number | null,
    metricType: string,
    minValue: number,
    maxValue: number,
    Cesium: typeof import('cesium')
  ): Cesium.Color => {
    if (value === null || isNaN(value)) {
      return Cesium.Color.GRAY.withAlpha(0.3);
    }

    const config = METRIC_CONFIG[metricType as keyof typeof METRIC_CONFIG];
    if (!config) {
      return Cesium.Color.BLUE.withAlpha(0.6);
    }

    // Validate min/max values to prevent division by zero
    if (isNaN(minValue) || isNaN(maxValue) || minValue === maxValue) {
      // If all values are the same, use the middle color
      const midColor = config.colorScale.min;
      return new Cesium.Color(midColor[0], midColor[1], midColor[2], midColor[3]);
    }

    // Normalize value to 0-1 range
    const normalizedValue = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
    
    // Interpolate between min and max colors
    const minColor = config.colorScale.min;
    const maxColor = config.colorScale.max;
    
    const r = minColor[0] + (maxColor[0] - minColor[0]) * normalizedValue;
    const g = minColor[1] + (maxColor[1] - minColor[1]) * normalizedValue;
    const b = minColor[2] + (maxColor[2] - minColor[2]) * normalizedValue;
    const a = minColor[3] + (maxColor[3] - minColor[3]) * normalizedValue;
    
    // Validate final color values
    const finalR = isNaN(r) ? minColor[0] : Math.max(0, Math.min(1, r));
    const finalG = isNaN(g) ? minColor[1] : Math.max(0, Math.min(1, g));
    const finalB = isNaN(b) ? minColor[2] : Math.max(0, Math.min(1, b));
    const finalA = isNaN(a) ? minColor[3] : Math.max(0, Math.min(1, a));
    
    return new Cesium.Color(finalR, finalG, finalB, finalA);
  }, []);

  // Create heatmap visualization
  const createHeatmap = useCallback(async (
    data: CityGlobeData[],
    metricType: string,
    Cesium: typeof import('cesium'),
    onCityClick?: (cityName: string) => void
  ) => {
    if (!viewerRef.current || !data.length) return;

    const viewer = viewerRef.current;
    
    // Reuse the existing datasource and update entities IN PLACE. Tearing down and
    // recreating ~600 entities (each with fresh canvases + GPU texture uploads) on every
    // filter/metric change was a major repaint cost; now an entity's material/billboard
    // only changes when its quantized color actually changed.
    let dataSource = dataSourceRef.current as Cesium.CustomDataSource | null;
    if (!dataSource) {
      dataSource = new Cesium.CustomDataSource('heatmap');
      dataSourceRef.current = dataSource;
      // Attach IMMEDIATELY (an empty attached datasource is harmless). Attaching only at
      // the end of a successful paint orphaned the ref when the first paint early-returned
      // (e.g. a sparse metric with no valid values): every later paint then wrote entities
      // into a datasource the viewer never rendered, blanking the heatmap permanently.
      viewer.dataSources.add(dataSource);
    }

    const config = METRIC_CONFIG[metricType as keyof typeof METRIC_CONFIG];
    if (!config) return;

    // Filter data with valid coordinates and metric values
    const validData = data.filter(item => {
      const lat = typeof item.latitude === 'string' ? parseFloat(item.latitude) : item.latitude;
      const lng = typeof item.longitude === 'string' ? parseFloat(item.longitude) : item.longitude;
      const rawValue = (item as any)[config.property];
      const value = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
      
      return lat !== null && !isNaN(lat) && 
             lng !== null && !isNaN(lng) && 
             value !== null && !isNaN(value);
    });

    // No paintable cities (e.g. a metric with no data under the current filters):
    // clear any stale entities from the previous paint, matching the old
    // teardown-and-rebuild behavior, instead of leaving the last heatmap up.
    const clearAll = () => {
      if (dataSource!.entities.values.length > 0) {
        dataSource!.entities.removeAll();
        hoveredEntityRef.current = null;
        viewer.scene.requestRender();
      }
    };

    if (validData.length === 0) {
      clearAll();
      return;
    }

    // Calculate min/max values for color scaling
    const values = validData.map(item => {
      const rawValue = (item as any)[config.property];
      return typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
    }).filter(v => v !== null && !isNaN(v));

    if (values.length === 0) {
      clearAll();
      return;
    }
    
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    // Billboard/label settings depend on the scene mode (the morphComplete handler adjusts
    // EXISTING entities on morph; entities created while already in 2D must match).
    const is2D = viewer.scene.mode === Cesium.SceneMode.SCENE2D;
    const billboardHeightReference = new Cesium.ConstantProperty(
      is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND
    );
    const billboardEyeOffset = is2D
      ? new Cesium.Cartesian3(0, 0, 0)
      : new Cesium.Cartesian3(0, 0, -5000);
    const depthTestDistance = is2D ? Number.POSITIVE_INFINITY : 1000000;

    // Create or update one entity per city. Batch all mutations between
    // suspendEvents/resumeEvents so Cesium coalesces the change notifications.
    const entities = dataSource.entities;
    entities.suspendEvents();
    const seenIds = new Set<string>();

    const num = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === 'string' ? parseFloat(v) : (v as number);
      return isNaN(n) ? null : n;
    };

    validData.forEach(item => {
      const rawValue = (item as any)[config.property];
      const value = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
      const color = getColorForMetric(value, metricType, minValue, maxValue, Cesium);
      const colorKey = quantizeColorKey(color);

      // Scale ellipse size based on city population (or default if not available)
      const population = typeof item.population === 'string' ? parseFloat(item.population) : item.population;

      // Calculate radius in meters based on population
      // Formula: sqrt(population / π) with scaling factor for visibility
      let radiusMeters = 5000; // Default 5km for unknown population
      if (population && !isNaN(population) && population > 0) {
        // Scale: 1M people = ~10km radius, 10M = ~30km radius
        radiusMeters = Math.sqrt(population / Math.PI) * 3;
        radiusMeters = Math.max(3000, Math.min(radiusMeters, 50000)); // Clamp between 3-50km
      }

      // Intensity-based size modifier (higher values = slightly larger)
      const normalizedValue = (value - minValue) / (maxValue - minValue);
      const intensityMultiplier = 0.8 + (normalizedValue * 0.4); // 0.8 to 1.2 range
      radiusMeters *= intensityMultiplier;

      // Hover card: the selected metric plus the other columns /api/data serves
      // (population, sample sizes, age, speed, WHO-style traffic mortality).
      const totalVideos = num(item.total_videos);
      const totalPeds = num(item.total_pedestrians);
      const avgAge = num(item.avg_pedestrian_age);
      const speed = num(item.avg_crossing_speed);
      const mortality = num(item.traffic_mortality);
      const contextLine = [
        avgAge != null ? `avg age ${avgAge.toFixed(1)}` : null,
        speed != null ? `crossing speed ${speed.toFixed(2)} m/s` : null,
      ].filter(Boolean).join(' · ');
      const labelText = [
        `${item.city}, ${item.country}`,
        `${config.name}: ${value?.toFixed(2)} ${config.unit}`,
        population ? `Population: ${population.toLocaleString()}` : null,
        totalVideos != null && totalPeds != null
          ? `Sample: ${totalVideos} video${totalVideos === 1 ? '' : 's'} · ${totalPeds.toLocaleString()} pedestrians`
          : null,
        contextLine || null,
        mortality != null ? `Traffic mortality: ${mortality.toFixed(1)} per 100k` : null,
      ].filter(Boolean).join('\n');

      const entityId = `heatmap-${item.id}`;
      seenIds.add(entityId);
      const existing = entities.getById(entityId);

      if (existing) {
        // Update in place; touch the GPU-backed material/billboard only on a real
        // color change, and the ellipse axes only on a real radius change.
        const props: any = existing.properties;
        if (props?.colorKey?.getValue() !== colorKey) {
          existing.ellipse!.material = new Cesium.ImageMaterialProperty({
            image: getGradientCanvas(color),
            transparent: true,
          }) as any;
          (existing.billboard as any).image = getDotCanvas(color);
          props.colorKey = colorKey;
        }
        if (props?.radiusMeters?.getValue() !== radiusMeters) {
          (existing.ellipse as any).semiMinorAxis = radiusMeters;
          (existing.ellipse as any).semiMajorAxis = radiusMeters;
          props.radiusMeters = radiusMeters;
        }
        (existing.label as any).text = labelText;
        props.metricValue = value;
        props.metricType = metricType;
        return;
      }

      // Create main ellipse (city coverage area)
      entities.add({
        id: entityId,
        position: Cesium.Cartesian3.fromDegrees(
          typeof item.longitude === 'string' ? parseFloat(item.longitude) : item.longitude!,
          typeof item.latitude === 'string' ? parseFloat(item.latitude) : item.latitude!,
          30 // lift slightly above ground to avoid terrain clipping
        ),
        ellipse: {
          semiMinorAxis: radiusMeters,
          semiMajorAxis: radiusMeters,
          material: new Cesium.ImageMaterialProperty({
            image: getGradientCanvas(color),
            transparent: true,
          }),
          heightReference: new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        // Central marker (billboard) for better visibility and to avoid terrain clipping
        billboard: {
          image: getDotCanvas(color),
          scale: 1.0,
          heightReference: billboardHeightReference,
          // Pull forward in eye space to avoid local terrain clipping while still occluding behind globe
          eyeOffset: billboardEyeOffset,
          disableDepthTestDistance: depthTestDistance,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        },
        label: {
          text: labelText,
          font: '14pt sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -60),
          show: false, // Hide by default, show on hover
          // Keep labels readable when in front hemisphere, but not through the back side of the globe
          disableDepthTestDistance: depthTestDistance,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
          showBackground: true,
          backgroundPadding: new Cesium.Cartesian2(8, 4),
        },
        properties: {
          city: item.city,
          country: item.country,
          metricValue: value,
          metricType: metricType,
          radiusMeters: radiusMeters,
          colorKey: colorKey,
        }
      });
    });

    // Drop entities for cities filtered out of this repaint.
    const toRemove = entities.values.filter(e => !seenIds.has(e.id as string));
    toRemove.forEach(e => entities.remove(e));
    if (hoveredEntityRef.current && toRemove.includes(hoveredEntityRef.current)) {
      hoveredEntityRef.current = null;
    }

    entities.resumeEvents();
    // requestRenderMode: paint the updated heatmap now (datasource was attached on creation).
    viewer.scene.requestRender();

    // Remove any previously-registered hover/click handler before creating a new
    // one. createHeatmap runs on every metric/filter change, so without this the
    // ScreenSpaceEventHandlers leak and multiple duplicate listeners stack up.
    if (heatmapHandlerRef.current) {
      heatmapHandlerRef.current.destroy();
      heatmapHandlerRef.current = null;
    }

    // Add hover effects
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    heatmapHandlerRef.current = handler;

    handler.setInputAction((event: any) => {
      const pickedObject = viewer.scene.pick(event.endPosition);
      const pickedEntity: Cesium.Entity | null =
        Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.label
          ? pickedObject.id
          : null;

      // Only two labels can ever change per move: the previously hovered one and the new
      // one. Skip all work (and re-renders) while hovering the same entity or empty space.
      const prev = hoveredEntityRef.current;
      if (prev === pickedEntity) return;
      if (prev && prev.label) (prev.label.show as any) = false;
      if (pickedEntity && pickedEntity.label) (pickedEntity.label.show as any) = true;
      hoveredEntityRef.current = pickedEntity;
      viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Add click handler to select city or open video
    handler.setInputAction((event: any) => {
      const pickedObject = viewer.scene.pick(event.position);
      
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
        // Check if it's a video marker
        const isVideo = pickedObject.id.properties.isVideo?.getValue();
        if (isVideo) {
          const videoLink = pickedObject.id.properties.videoLink?.getValue();
          if (videoLink) {
            // Construct YouTube URL: https://www.youtube.com/watch?v= + video link
            const youtubeUrl = `https://www.youtube.com/watch?v=${videoLink}`;
            // Open video URL in a new tab
            window.open(youtubeUrl, '_blank', 'noopener,noreferrer');
            return;
          }
        }

        // Localization candidate marker → open its Google Maps location
        const isCandidate = pickedObject.id.properties.isCandidate?.getValue();
        if (isCandidate) {
          const mapsUrl = pickedObject.id.properties.mapsUrl?.getValue();
          if (mapsUrl) {
            window.open(mapsUrl, '_blank', 'noopener,noreferrer');
            return;
          }
        }
        
        // Otherwise, handle as city selection
        const cityName = pickedObject.id.properties.city?.getValue();
        if (cityName && onCityClick) {
          onCityClick(cityName);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  }, [getColorForMetric, videoDataSourceRef]);

  // Create video markers on globe
  const createVideoMarkers = useCallback(async (
    videos: VideoData[],
    Cesium: typeof import('cesium')
  ) => {
    if (!viewerRef.current) {
      console.warn('[Globe] Viewer not ready');
      return;
    }

    const viewer = viewerRef.current;

    // Filter videos that have coordinates (either video-specific or city fallback) BEFORE
    // touching the datasource, so the empty cases share one clear-and-repaint path.
    const videosWithCoords = videos.filter(video => {
      const lat = video.latitude ?? video.city_latitude;
      const lng = video.longitude ?? video.city_longitude;
      const hasCoords = lat !== null && lng !== null && !isNaN(Number(lat)) && !isNaN(Number(lng));
      if (!hasCoords) {
        console.warn('[Globe] Video without coordinates:', video.video_name, { lat, lng, video_lat: video.latitude, video_lng: video.longitude, city_lat: video.city_latitude, city_lng: video.city_longitude });
      }
      return hasCoords;
    });

    if (videosWithCoords.length === 0) {
      // No markers to paint: remove any existing ones and repaint (requestRenderMode),
      // leaving the ref null rather than pointing at a never-attached datasource.
      if (videoDataSourceRef.current) {
        viewer.dataSources.remove(videoDataSourceRef.current);
        videoDataSourceRef.current = null;
        viewer.scene.requestRender();
      }
      return;
    }

    // Remove existing video data source
    if (videoDataSourceRef.current) {
      viewer.dataSources.remove(videoDataSourceRef.current);
    }

    // Create new data source for videos
    const videoDataSource = new Cesium.CustomDataSource('videos');
    videoDataSourceRef.current = videoDataSource;

    // Match the current scene mode at creation time (morphComplete only adjusts on morph).
    const is2D = viewer.scene.mode === Cesium.SceneMode.SCENE2D;
    const markerHeightReference = new Cesium.ConstantProperty(
      is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND
    );
    const markerEyeOffset = is2D
      ? new Cesium.Cartesian3(0, 0, 0)
      : new Cesium.Cartesian3(0, 0, -1000);
    const markerDepthTestDistance = is2D ? Number.POSITIVE_INFINITY : 1000000;

    // Create markers for each video
    videosWithCoords.forEach((video, index) => {
      const lat = video.latitude ?? video.city_latitude;
      const lng = video.longitude ?? video.city_longitude;
      
      const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
      const lngNum = typeof lng === 'string' ? parseFloat(lng) : lng;
      
      if (latNum === null || lngNum === null || isNaN(latNum) || isNaN(lngNum)) {
        console.warn(`[Globe] Skipping video ${video.video_name} - invalid coordinates:`, { lat, lng });
        return;
      }

      const entity = videoDataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          lngNum,
          latNum,
          50 // Slightly above ground
        ),
        billboard: {
          image: createVideoDotCanvas(),
          scale: 1.0,
          heightReference: markerHeightReference,
          eyeOffset: markerEyeOffset,
          disableDepthTestDistance: markerDepthTestDistance,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        },
        label: {
          text: [
            video.video_name,
            video.link,
            // Real localization provenance, when present (PedX-Insight --mode localize)
            video.street_name ? `📍 ${video.street_name}` : null,
            video.localization_confidence ? `Localization: ${video.localization_confidence} confidence` : null,
            video.localization_spread_m != null
              ? `Uncertainty: ±${video.localization_spread_m >= 1000
                  ? (video.localization_spread_m / 1000).toFixed(1) + ' km'
                  : Math.round(video.localization_spread_m) + ' m'}`
              : null,
            video.localization_candidates && video.localization_candidates.length > 1
              ? `${video.localization_candidates.length} candidate locations (amber dots)`
              : null,
            video.risky_crossing_ratio != null
              ? `Risky crossing: ${(video.risky_crossing_ratio * 100).toFixed(0)}%`
              : null,
            'Click to open video',
          ].filter(Boolean).join('\n'),
          font: '12pt sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -40),
          show: false, // Hide by default, show on hover
          disableDepthTestDistance: markerDepthTestDistance,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
          showBackground: true,
          backgroundPadding: new Cesium.Cartesian2(8, 4),
        },
        properties: {
          videoId: video.id,
          videoName: video.video_name,
          videoLink: video.link,
          isVideo: true,
        }
      });

      // --- Monocular localization detail: uncertainty circle + candidate points + connector ---
      // Only for videos with a REAL localized point (status 'ok'), not the city-centre fallback.
      const isLocalized = video.latitude != null && video.longitude != null && video.localization_status === 'ok';
      if (isLocalized) {
        // Uncertainty disk (radius = confidence spread in metres), clamped to ground.
        if (video.localization_spread_m && video.localization_spread_m > 0) {
          const r = Math.min(video.localization_spread_m, 50000); // clamp huge low-confidence spreads
          videoDataSource.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lngNum, latNum),
            ellipse: {
              semiMinorAxis: r,
              semiMajorAxis: r,
              material: Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.10),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
          });
        }

        // Dashed connector from the city centre to the chosen point (how far localization moved).
        if (video.city_latitude != null && video.city_longitude != null) {
          videoDataSource.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray([
                Number(video.city_longitude), Number(video.city_latitude),
                lngNum, latNum,
              ]),
              width: 1.5,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.5),
              }),
              clampToGround: true,
            },
          });
        }

        // Candidate alternatives (rank >= 2); rank 1 is the chosen point (already a marker).
        const candidates = Array.isArray(video.localization_candidates) ? video.localization_candidates : [];
        candidates
          .filter((cand) => cand && cand.rank !== 1 && Number.isFinite(cand.latitude) && Number.isFinite(cand.longitude))
          .forEach((cand) => {
            const streets = Array.isArray(cand.street_names) ? cand.street_names.slice(0, 3).join(', ') : '';
            videoDataSource.entities.add({
              position: Cesium.Cartesian3.fromDegrees(cand.longitude, cand.latitude, 30),
              billboard: {
                image: createCandidateDotCanvas(),
                scale: 1.0,
                heightReference: markerHeightReference,
                disableDepthTestDistance: markerDepthTestDistance,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              },
              label: {
                text: [
                  `Candidate #${cand.rank}${video.video_name ? ' · ' + video.video_name : ''}`,
                  streets ? `📍 ${streets}` : null,
                  cand.support != null ? `Support: ${cand.support}` : null,
                  'Click to open in Google Maps',
                ].filter(Boolean).join('\n'),
                font: '11pt sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -28),
                show: false,
                disableDepthTestDistance: markerDepthTestDistance,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
                showBackground: true,
                backgroundPadding: new Cesium.Cartesian2(8, 4),
              },
              properties: {
                isCandidate: true,
                mapsUrl: cand.google_maps_url || `https://www.google.com/maps?q=${cand.latitude},${cand.longitude}`,
              },
            });
          });
      }
    });

    // Add data source to viewer
    viewer.dataSources.add(videoDataSource);
    // requestRenderMode: paint the new markers now.
    viewer.scene.requestRender();

    // Note: Hover effects and click handlers are handled by the existing handler in createHeatmap
    // Video markers will work with the same handlers since they're in a separate data source
    // The click handler checks for isVideo property to distinguish video markers from city markers

  }, []);

  // Zoom to city
  const zoomToCity = useCallback(async (cityName: string, Cesium: typeof import('cesium')) => {
    if (!viewerRef.current) return;

    const viewer = viewerRef.current;
    
    // Find city in the existing cityData (same data source as heatmap)
    const cityInfo = cityData.find(city => city.city === cityName);
    if (!cityInfo) {
      console.warn(`City ${cityName} not found in cityData`);
      return;
    }

    // Extract coordinates - use the EXACT same logic as the heatmap
    const lat = typeof cityInfo.latitude === 'string' ? parseFloat(cityInfo.latitude) : cityInfo.latitude;
    const lng = typeof cityInfo.longitude === 'string' ? parseFloat(cityInfo.longitude) : cityInfo.longitude;

    // Use explicit null/NaN checks: `!lat`/`!lng` would wrongly reject valid
    // coordinates on the equator (lat 0) or prime meridian (lng 0).
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
      console.warn(`Invalid coordinates for ${cityName}: lat=${lat}, lng=${lng}`);
      return;
    }

    // Get population for appropriate zoom level
    const population = typeof cityInfo.population === 'string' ? parseFloat(cityInfo.population) : cityInfo.population;
    
    // Calculate zoom altitude based on city size
    // Larger cities need higher altitude to see the full heatmap circle
    let altitude = 15000; // Default 15km
    if (population && !isNaN(population) && population > 0) {
      // Match the heatmap radius calculation
      let radiusMeters = Math.sqrt(population / Math.PI) * 3;
      radiusMeters = Math.max(3000, Math.min(radiusMeters, 50000));
      // Zoom out to 2.5x the radius so the full circle is visible
      altitude = radiusMeters * 2.5;
      // Clamp between 10km and 80km
      altitude = Math.max(10000, Math.min(altitude, 80000));
    }


    // Calculate offset to compensate for pitch angle
    // When camera is tilted at -45°, the center of view is actually SOUTH of target
    // We need to offset the target point slightly south to compensate
    const pitchAngle = -45.0; // degrees
    const pitchRadians = Cesium.Math.toRadians(pitchAngle);
    
    // Calculate how much to offset based on altitude and pitch
    // tan(pitch) * altitude gives horizontal distance to actual center point
    const offsetDistance = Math.tan(Math.abs(pitchRadians)) * altitude;
    
    // Convert to latitude offset (roughly 111km per degree of latitude)
    const latOffsetDegrees = (offsetDistance / 111000); // meters to degrees
    
    // Adjust target latitude SOUTH to account for viewing angle
    const adjustedLat = lat - latOffsetDegrees;


    // Fly to the city with centered view
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, adjustedLat, altitude),
      duration: 2.0,
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(pitchAngle),
        roll: 0.0
      }
    });
  }, [cityData]);

  // Keep refs in sync with the latest values so the one-time init effect's
  // morphComplete listener can read current state without re-running.
  useEffect(() => {
    selectedMetricsRef.current = selectedMetrics;
    fetchGlobalDataRef.current = fetchGlobalData;
    createHeatmapRef.current = createHeatmap;
  });

  // Initialize Cesium
  useEffect(() => {
    const initCesium = async () => {
      if (!cesiumContainer.current) {
        console.warn('Cesium container not ready, retrying...');
        setTimeout(initCesium, 100);
        return;
      }

      // loadCesium sets window.CESIUM_BASE_URL (env-configurable, documented in
      // env.example) before the bundle script executes.
      const Cesium = await loadCesium();

      // Prefer the env-provided Ion token. The committed literal is a fallback so
      // the app keeps working, but it should be rotated and moved to env only.
      Cesium.Ion.defaultAccessToken =
        process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiY2FhOThlNi1iNDMwLTQyYTQtYmNjNy0zNGMyYzIwNTg1YTUiLCJpZCI6MzQxNDgwLCJpYXQiOjE3NTc5MzY2Mzh9.ATR_-WPV_pD-R9uod-sFaDzlzDYM0f-MlmGRFg393d4';

      // Use Cesium's default sets, which include all Ion imagery/terrain options available with the token
      const imageryProviderViewModels = (Cesium as any).createDefaultImageryProviderViewModels
        ? (Cesium as any).createDefaultImageryProviderViewModels()
        : [];
      // Filter out Ion imagery options that can fail without proper entitlements
      const blockedImageryNames = new Set(['Sentinel-2', 'Blue Marble', 'Earth at night', 'Earth at Night']);
      const safeImageryProviderViewModels = imageryProviderViewModels.filter((vm: any) => !blockedImageryNames.has(vm?.name));

      const terrainProviderViewModels = (Cesium as any).createDefaultTerrainProviderViewModels
        ? (Cesium as any).createDefaultTerrainProviderViewModels()
        : [];

      const viewer = new Cesium.Viewer(cesiumContainer.current, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        // Render on demand instead of continuously. Without this Cesium redraws the whole
        // scene (terrain + OSM buildings + ~600 textured entities) at display refresh rate
        // forever, pegging the GPU and making the entire app feel sluggish. Camera moves,
        // tile loads and dataSource changes request frames automatically; our own
        // programmatic changes call scene.requestRender() explicitly.
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        homeButton: true,
        // Use built-in SceneModePicker UI
        sceneModePicker: true,
        baseLayerPicker: true,
        imageryProviderViewModels: safeImageryProviderViewModels,
        terrainProviderViewModels,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        infoBox: false, // Disable the default info box that shows entity IDs
        selectionIndicator: false, // Disable the green selection indicator
      });
      // Occlude primitives by globe/terrain
      try {
        viewer.scene.globe.depthTestAgainstTerrain = true;
      } catch (_) {}
      // Hide the Cesium Ion attribution
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = "none";

      viewerRef.current = viewer;

      // Hide Columbus View (2.5D) option from the SceneModePicker UI robustly
      try {
        const smp: any = (viewer as any).sceneModePicker;
        const Command = (Cesium as any).Command;

        const hideColumbus = () => {
          // Disable the command if possible
          if (smp?.viewModel?.morphToColumbusView && Command) {
            smp.viewModel.morphToColumbusView = new Command(() => {}, false);
          }
          // Hide button by known class, title attribute, or by position (middle button)
          const container: HTMLElement | undefined = smp?.container as HTMLElement | undefined;
          if (container) {
            const btnByClass = container.querySelector('.cesium-sceneModePicker-buttonColumbus') as HTMLElement | null;
            if (btnByClass) btnByClass.style.display = 'none';
            // Fallback: search any button whose title mentions Columbus
            const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
            buttons.forEach((b) => {
              const title = (b.getAttribute('title') || '').toLowerCase();
              if (title.includes('columbus')) {
                b.style.display = 'none';
              }
            });
            // Fallback: hide middle button (order typically 3D, Columbus, 2D)
            const wrapper = container.querySelector('.cesium-sceneModePicker-wrapper') as HTMLElement | null;
            if (wrapper) {
              const middle = wrapper.querySelector('button:nth-child(2)') as HTMLElement | null;
              if (middle) middle.style.display = 'none';
            }
          }
        };

        // Inject global CSS as a final fallback to enforce hiding
        try {
          const style = document.createElement('style');
          style.setAttribute('data-hide-columbus', 'true');
          style.textContent = `
            .cesium-sceneModePicker-buttonColumbus { display: none !important; }
            .cesium-sceneModePicker-wrapper button[title*="Columbus"],
            .cesium-sceneModePicker-wrapper button[title*="columbus"] { display: none !important; }
            /* Middle button is Columbus in default layout */
            .cesium-sceneModePicker-wrapper button:nth-child(2) { display: none !important; }
          `;
          // Only append once
          if (!document.head.querySelector('style[data-hide-columbus="true"]')) {
            document.head.appendChild(style);
          }
        } catch (_) {}

        hideColumbus();
        // Observe for re-renders to ensure it stays hidden
        const container: HTMLElement | undefined = smp?.container as HTMLElement | undefined;
        if (container && (window as any).MutationObserver) {
          const mo = new MutationObserver(() => hideColumbus());
          mo.observe(container, { childList: true, subtree: true, attributes: true });
        }
      } catch (_) {}

      // Error listeners to surface real provider/render errors in console
      try {
        viewer.scene.globe.terrainProvider.errorEvent.addEventListener((err: any) => {
          // eslint-disable-next-line no-console
          console.error('Terrain provider error:', err);
        });
      } catch (_) {}

      try {
        viewer.imageryLayers.layerAdded.addEventListener((layer: any) => {
          try {
            layer.imageryProvider?.errorEvent?.addEventListener((err: any) => {
              // eslint-disable-next-line no-console
              console.error('Imagery provider error:', err);
            });
          } catch (_) {}
        });
      } catch (_) {}

      try {
        viewer.scene.renderError.addEventListener((err: any) => {
          // eslint-disable-next-line no-console
          console.error('Scene render error:', err);
        });
      } catch (_) {}

      // Set initial camera position (global view)
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(0, 20, 20000000), // Global view
        orientation: {
          heading: 0.0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0.0
        }
      });

      // Add OSM Buildings
      try {
        const buildingTileset = await Cesium.createOsmBuildingsAsync();
        viewer.scene.primitives.add(buildingTileset);
      } catch (error) {
        console.warn('Could not load OSM Buildings:', error);
      }

      // Disable default double-click behavior
      viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

      // Re-sync dots/heatmap when switching 3D ↔ 2D
      try {
        viewer.scene.morphComplete.addEventListener(async () => {
          const mode = viewer.scene.mode;
          // In 2D, no terrain depth testing; in 3D, enable occlusion
          viewer.scene.globe.depthTestAgainstTerrain = mode !== Cesium.SceneMode.SCENE2D;

          // Adjust existing entities to the new mode
          if (dataSourceRef.current) {
            const entities = dataSourceRef.current.entities.values;
            entities.forEach((ent: Cesium.Entity) => {
              if (ent.billboard) {
                if (mode === Cesium.SceneMode.SCENE2D) {
                  ent.billboard.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE);
                  ent.billboard.eyeOffset = new Cesium.ConstantProperty(new Cesium.Cartesian3(0, 0, 0));
                  ent.billboard.disableDepthTestDistance = new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);
                } else {
                  ent.billboard.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.RELATIVE_TO_GROUND);
                  ent.billboard.eyeOffset = new Cesium.ConstantProperty(new Cesium.Cartesian3(0, 0, -5000));
                  ent.billboard.disableDepthTestDistance = new Cesium.ConstantProperty(1000000);
                }
              }
              if (ent.label) {
                if (mode === Cesium.SceneMode.SCENE2D) {
                  ent.label.disableDepthTestDistance = new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);
                } else {
                  ent.label.disableDepthTestDistance = new Cesium.ConstantProperty(1000000);
                }
              }
            });
          }

          // Adjust video entities to the new mode
          if (videoDataSourceRef.current) {
            const entities = videoDataSourceRef.current.entities.values;
            entities.forEach((ent: Cesium.Entity) => {
              if (ent.billboard) {
                if (mode === Cesium.SceneMode.SCENE2D) {
                  ent.billboard.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE);
                  ent.billboard.eyeOffset = new Cesium.ConstantProperty(new Cesium.Cartesian3(0, 0, 0));
                  ent.billboard.disableDepthTestDistance = new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);
                } else {
                  ent.billboard.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.RELATIVE_TO_GROUND);
                  ent.billboard.eyeOffset = new Cesium.ConstantProperty(new Cesium.Cartesian3(0, 0, -1000));
                  ent.billboard.disableDepthTestDistance = new Cesium.ConstantProperty(1000000);
                }
              }
              if (ent.label) {
                if (mode === Cesium.SceneMode.SCENE2D) {
                  ent.label.disableDepthTestDistance = new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);
                } else {
                  ent.label.disableDepthTestDistance = new Cesium.ConstantProperty(1000000);
                }
              }
            });
          }

          // If a metric is active, rebuild the heatmap to ensure perfect alignment in new mode.
          // Read through refs so we use the CURRENT metric/filters rather than the values
          // captured when this one-time init effect first ran.
          try {
            const activeMetrics = selectedMetricsRef.current;
            if (activeMetrics.length > 0 && fetchGlobalDataRef.current && createHeatmapRef.current) {
              const data = await fetchGlobalDataRef.current();
              await createHeatmapRef.current(data, activeMetrics[0], Cesium, setSelectedCity);
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Heatmap rebuild after morph failed:', e);
          }
        });
      } catch (_) {}
    };

    const timeoutId = setTimeout(() => {
      initCesium().catch(console.error);
    }, 100);

    const handleResize = () => {
      if (viewerRef.current) {
        viewerRef.current.resize();
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      if (heatmapHandlerRef.current) {
        heatmapHandlerRef.current.destroy();
        heatmapHandlerRef.current = null;
      }
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      dataSourceRef.current = null;
      videoDataSourceRef.current = null;
    };
  }, []);

  // Handle metric selection and filter changes
  useEffect(() => {
    if (!viewerRef.current || selectedMetrics.length === 0) {
      // Clear heatmap if no metrics selected
      if (dataSourceRef.current && viewerRef.current) {
        viewerRef.current.dataSources.remove(dataSourceRef.current);
        dataSourceRef.current = null;
        hoveredEntityRef.current = null;
        viewerRef.current.scene.requestRender();
      }
      return;
    }

    // Debounce updates to prevent flickering when filters change rapidly.
    // `cancelled` gives last-write-wins semantics: if the filters/metric change again while a
    // fetch is in flight, this run is marked cancelled in cleanup and will not repaint the
    // globe, so a slow response can't overwrite the view for the newer filter set.
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      try {
        const data = await fetchGlobalData();
        if (cancelled) return;
        if (data.length === 0) {
          console.warn('[Globe] No data returned from API - check filters');
        }
        const Cesium = await loadCesium();
        if (cancelled) return;

        // Use the first selected metric for heatmap
        const metricType = selectedMetrics[0];
        await createHeatmap(data, metricType, Cesium, setSelectedCity);
      } catch (error) {
        console.error('[Globe] Error updating heatmap:', error);
      }
    }, 300); // 300ms debounce

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    selectedMetrics, 
    vehicleFiltersKey,
    clothingFiltersKey,
    createHeatmap, 
    fetchGlobalData, 
    setSelectedCity
  ]);

  // Zoom to the selected city (video markers are handled by the effect below,
  // driven by the shared FilterContext.cityVideos fetch).
  useEffect(() => {
    if (!viewerRef.current || !selectedCity) return;

    let cancelled = false;
    (async () => {
      const Cesium = await loadCesium();
      if (cancelled) return;
      await zoomToCity(selectedCity, Cesium);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCity, zoomToCity]);

  // Paint video markers whenever the shared city-videos data changes.
  // Context sets cityVideos = [] when no city is selected, and
  // createVideoMarkers([]) clears the marker datasource.
  useEffect(() => {
    if (!viewerRef.current) return;

    let cancelled = false;
    (async () => {
      const Cesium = await loadCesium();
      if (cancelled) return;
      await createVideoMarkers(cityVideos, Cesium);
    })();
    return () => {
      cancelled = true;
    };
  }, [cityVideos, createVideoMarkers]);

  // Listen for globe reset event
  useEffect(() => {
    const resetGlobe = async () => {
      if (!viewerRef.current) return;

      const Cesium = await loadCesium();
      const viewer = viewerRef.current;
      
      // Reset camera to original global view
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0, 20, 20000000),
        duration: 2,
      });
    };

    window.addEventListener('resetGlobe', resetGlobe);
    return () => window.removeEventListener('resetGlobe', resetGlobe);
  }, []);

  return (
    <div className="relative w-full h-full">
      <div
        ref={cesiumContainer}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
      
      
      {/* Heatmap Legend - moved to bottom right */}
      {selectedMetrics.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-black/90 backdrop-blur-sm text-white p-4 rounded-lg text-sm shadow-lg max-w-xs">
          <div className="font-semibold mb-3 text-base">
            🗺️ {METRIC_CONFIG[selectedMetrics[0] as keyof typeof METRIC_CONFIG]?.name || selectedMetrics[0]}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-green-500/70 rounded-full blur-sm"></div>
                <span className="text-xs">Low</span>
              </div>
              <div className="w-24 h-3 bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 rounded-full opacity-70"></div>
              <div className="flex items-center space-x-2">
                <span className="text-xs">High</span>
                <div className="w-5 h-5 bg-red-500/70 rounded-full blur-sm"></div>
              </div>
            </div>
            <div className="text-xs text-gray-300 pt-2 border-t border-gray-600">
              <div>Unit: <span className="font-mono">{METRIC_CONFIG[selectedMetrics[0] as keyof typeof METRIC_CONFIG]?.unit || ''}</span></div>
              <div className="mt-1 text-gray-400">Area size reflects city population</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}