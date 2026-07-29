'use client';

import { useEffect, useRef, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
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

type Rgba = readonly [number, number, number, number];

// A metric is RANKED for a city only when that city's `sample.property` value is >= minN.
// Below that the city is still drawn — as a hollow ring, off the colour ramp — because it
// does have a real number; it just has too little evidence to be positioned against others.
// `sample` absent means no gate is available for this metric (see the per-entry notes).
interface SampleRule {
  property: string;   // column in the /api/data payload holding the denominator
  minN: number;       // below this, the city is shown but not ranked
  noun: string;       // what the n counts, for the hover and legend copy
}
interface MetricConfig {
  property: string;
  name: string;
  unit: string;
  colorScale: { min: Rgba; max: Rgba };
  sample?: SampleRule;
  caveat?: string;      // a limitation of the measurement
  provenance?: string;  // where the number comes from, when it is not measured from video
}

// Below this many ranked cities there is no meaningful ramp to draw, so the whole layer
// renders as rings and the legend says the scale is not established.
const MIN_RANKED_CITIES = 5;

// Metric configuration for easy extensibility
const METRIC_CONFIG: Record<string, MetricConfig> = {
  measured_crossing_speed: {
    property: 'avg_measured_crossing_speed',
    name: 'Measured Crossing Speed',
    unit: 'm/s',
    colorScale: {
      min: [1, 0.35, 0, 0.6],
      max: [0, 0.8, 0.4, 0.8],
    },
    // minN 10, not 30: a completed measured crossing is the scarcest unit in the corpus,
    // and n>=30 leaves only 3 cities — too few to draw a ramp at all. At n=10 six of the
    // twelve qualify and the domain tightens from 1.17-4.19 to 1.25-1.51.
    sample: { property: 'measured_crossing_sample', minN: 10, noun: 'measured crossings' },
    caveat: 'Half the cities with a value have too few crossings to rank',
  },
  look_before_cross: {
    property: 'avg_look_before_cross',
    name: 'Looked Before Crossing',
    unit: '%',
    colorScale: {
      min: [1, 0, 0, 0.6],
      max: [0, 1, 0, 0.8],
    },
    sample: { property: 'look_before_cross_sample', minN: 30, noun: 'crossing pedestrians' },
  },
  severe_conflicts: {
    // Repointed from the raw sum to an exposure-normalised rate. The sum was an exposure
    // map, not a danger map: Manila's 647 conflicts came from a 3,438-pedestrian video and
    // Cincinnati's 2 from a 16-pedestrian one. Normalising flips the ranking — Sydney
    // (27.6/100) now leads Manila (18.8/100).
    property: 'severe_conflicts_per_100_ped',
    name: 'Severe Conflicts per 100 Pedestrians',
    unit: 'per 100 ped',
    colorScale: {
      min: [0, 1, 0, 0.6],
      max: [1, 0, 0, 0.8],
    },
    sample: { property: 'pet_exposure_pedestrians', minN: 30, noun: 'tracked pedestrians' },
    caveat: 'Conflicts per 100 tracked pedestrians, not a raw count',
  },
  hesitation_rate: {
    // dense_v2 only: six cities were painted entirely from legacy_1hz videos with 2-6
    // tracked pedestrians, all reporting ~0.000, and they anchored the bottom of the ramp
    // with an artefact of a tracker the repo documents as fragmenting and under-counting.
    property: 'avg_hesitation_rate_dense',
    name: 'Hesitation Rate',
    unit: '%',
    colorScale: {
      min: [0, 1, 0, 0.6],
      max: [1, 0.5, 0, 0.8],
    },
    sample: { property: 'hesitation_dense_pedestrians', minN: 30, noun: 'tracked pedestrians' },
    caveat: 'dense_v2 videos only; legacy-tracker cities are not shown',
  },
  vehicle_speed: {
    property: 'avg_vehicle_speed',
    name: 'Vehicle Speed',
    unit: 'm/s',
    colorScale: {
      min: [0, 1, 0, 0.6],
      max: [1, 0, 0, 0.8],
    },
    sample: { property: 'vehicle_speed_sample', minN: 30, noun: 'tracked vehicles' },
    caveat: 'Values are implausibly low (0.3-4.8 km/h) and under review',
  },
  social_groups: {
    // Repointed from the raw group count (an exposure map, same as conflicts) to the share
    // of tracked pedestrians walking in company, dense_v2 only.
    property: 'grouped_pedestrian_share_dense',
    name: 'Pedestrians Walking in Groups',
    unit: '%',
    colorScale: {
      min: [0.2, 0.4, 1, 0.6],
      max: [1, 0.8, 0, 0.8],
    },
    sample: { property: 'social_dense_pedestrians', minN: 30, noun: 'tracked pedestrians' },
    caveat: 'dense_v2 videos only; legacy-tracker cities are not shown',
  },
  risky_crossing: {
    property: 'risky_crossing_rate',
    name: 'Risky Crossing Rate',
    unit: '%',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low risk (RGBA)
      max: [1, 0, 0, 0.8], // Red for high risk (RGBA)
    },
    // total_pedestrians IS the exact denominator of this rate. Without the gate, 302 of the
    // 470 painted cities rest on 1-9 pedestrians and nine paint exactly 1.000 off a single
    // one — the same defect as the crossing-speed layer, at 25x the scale.
    sample: { property: 'total_pedestrians', minN: 30, noun: 'pedestrians' },
  },
  run_red_light: {
    property: 'run_red_light_rate',
    name: 'Run Red Light Rate',
    unit: '%',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low rate
      max: [1, 0, 0, 0.8], // Red for high rate
    },
    sample: { property: 'total_pedestrians', minN: 30, noun: 'pedestrians' },
  },
  crosswalk_usage: {
    property: 'crosswalk_usage_rate',
    name: 'Crosswalk Usage Rate',
    unit: '%',
    colorScale: {
      min: [1, 0, 0, 0.6], // Red for low usage
      max: [0, 1, 0, 0.8], // Green for high usage
    },
    sample: { property: 'total_pedestrians', minN: 30, noun: 'pedestrians' },
  },
  phone_usage: {
    property: 'phone_usage_rate',
    name: 'Phone Usage While Crossing',
    unit: '%',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low usage
      max: [1, 0, 0, 0.8], // Red for high usage (dangerous)
    },
    sample: { property: 'total_pedestrians', minN: 30, noun: 'pedestrians' },
  },
  crossing_speed: {
    property: 'avg_crossing_speed',
    name: 'Average Crossing Speed',
    unit: 'm/s',
    colorScale: {
      min: [1, 0, 0, 0.6], // Red for slow (dangerous)
      max: [0, 1, 0, 0.8], // Green for fast (safer)
    },
    // No gate: this is an imported city constant, so a count would count copies of the same
    // number rather than observations. Its danger is the opposite of a thin sample — it
    // looks well-sampled (564 cities) while measuring nothing about the video.
    provenance: 'Imported city constant — see Measured Crossing Speed for the observed value',
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
    // Gated on the per-pedestrian count, not measured_speed_video_count: the latter is
    // exactly 1 for all 14 cities that have it, so it cannot discriminate.
    sample: { property: 'measured_walking_ped_sample', minN: 30, noun: 'tracked pedestrians' },
  },
  crossing_time: {
    property: 'avg_crossing_time',
    name: 'Average Crossing Time',
    unit: 'seconds',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for short time (safer)
      max: [1, 0, 0, 0.8], // Red for long time (more exposure)
    },
    // No gate: imported constant, same as crossing_speed.
    provenance: 'Imported city constant, not measured from video',
  },
  avg_age: {
    property: 'avg_pedestrian_age',
    name: 'Average Pedestrian Age',
    unit: 'years',
    colorScale: {
      min: [0.2, 0.6, 1, 0.6], // Blue for young
      max: [1, 0.6, 0.2, 0.8], // Orange for elderly
    },
    sample: { property: 'age_sample', minN: 30, noun: 'pedestrians with a recorded age' },
  },
  pedestrian_density: {
    property: 'avg_pedestrians_per_video',
    name: 'Pedestrian Density',
    unit: 'pedestrians',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low density
      max: [1, 0.6, 0, 0.8], // Orange for high density
    },
    // videos.total_pedestrians is not comparable across analysis pipelines: the legacy
    // 1 Hz tracker fragmented and under-counted, while dense_v2 counts every tracked
    // pedestrian. Only a handful of cities have been re-analysed on dense_v2, so this
    // layer is dominated by which pipeline ran, not by how busy the city is.
    caveat: 'Counts are not comparable across analysis pipelines',
  },
  road_width: {
    property: 'avg_road_width',
    name: 'Average Road Width',
    unit: 'meters',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for narrow (safer)
      max: [1, 0, 0, 0.8], // Red for wide (more dangerous)
    },
    // No n gate: 592 of 603 cities have exactly one video, so any video-count threshold
    // would leave a handful of cities. The limitation is provenance, not sample size.
    caveat: 'One camera view per city in 592 of 603 cities',
  },
  traffic_mortality: {
    property: 'traffic_mortality',
    name: 'Traffic Mortality',
    unit: 'per 100k',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for low mortality
      max: [1, 0, 0, 0.8], // Red for high mortality
    },
    // No gate: external reference data on 605 of 607 cities. A video-derived threshold
    // would hide correct data.
    provenance: 'External reference data (per 100k), not derived from video',
  },
};

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

// Mark for a city that has a value but too small a sample to rank: a hollow ring, so it
// reads as "present but not placed on the scale" rather than as a ramp position.
const LOW_CONFIDENCE_RGBA: Rgba = [0.82, 0.84, 0.88, 0.90];

const ringCanvasCache = new Map<string, HTMLCanvasElement>();
function getRingCanvas(color: any): HTMLCanvasElement {
  const key = quantizeColorKey(color);
  let canvas = ringCanvasCache.get(key);
  if (!canvas) {
    canvas = createRingCanvas(color);
    ringCanvasCache.set(key, canvas);
  }
  return canvas;
}

function createRingCanvas(color: any): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 20;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const css = `rgba(${Math.round((color?.red ?? 0.8) * 255)}, ${Math.round((color?.green ?? 0.8) * 255)}, ${Math.round((color?.blue ?? 0.9) * 255)}, ${color?.alpha ?? 0.9})`;
  // Dark outer stroke first so the ring stays legible over bright terrain.
  ctx.beginPath();
  ctx.arc(10, 10, 8.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(15,23,42,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(10, 10, 7, 0, Math.PI * 2);
  ctx.strokeStyle = css;
  ctx.lineWidth = 2;
  ctx.stroke();
  return canvas;
}

// ONE normalisation, used by BOTH the colour ramp and the radius multiplier — they used to
// compute it separately and the radius copy was unclamped and unguarded. Returns 0.5 for a
// degenerate or non-finite domain: never NaN, never outside [0,1].
function safeNormalize(v: number, min: number, max: number): number {
  if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return 0.5;
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

function readNumber(item: any, prop: string): number | null {
  const raw = item?.[prop];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'string' ? parseFloat(raw) : (raw as number);
  return Number.isFinite(n) ? n : null;
}

// Rates and fractions are stored 0-1 but labelled '%'; printing them raw gave "0.89 %".
function formatMetric(v: number, unit: string): string {
  return unit === '%' ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(2)} ${unit}`;
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

// Overlay preferences are per-user display choices, not data — remember them across
// reloads so the globe comes back the way it was left.
//
// Modelled as a real external store rather than "useState + read it in an effect": this
// page is server-rendered, so the stored value cannot be read during the first render, and
// setState-from-an-effect would cascade a second render on every mount. The in-memory
// cache is the source of truth so the toggles still work when localStorage throws
// (private mode, blocked cookies) — there, only the persistence is lost.
const toggleCache = new Map<string, boolean>();
const toggleListeners = new Map<string, Set<() => void>>();

function readToggle(key: string, fallback: boolean): boolean {
  const cached = toggleCache.get(key);
  if (cached !== undefined) return cached;
  let value = fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === 'true' || stored === 'false') value = stored === 'true';
  } catch {
    // Storage unavailable — the fallback is fine.
  }
  toggleCache.set(key, value);
  return value;
}

function usePersistentToggle(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    let listeners = toggleListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      toggleListeners.set(key, listeners);
    }
    listeners.add(onChange);
    // Another tab writing the same key fires `storage` here; drop the cache so the next
    // snapshot re-reads it, and both tabs stay in step.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      toggleCache.delete(key);
      onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);

  const value = useSyncExternalStore(
    subscribe,
    () => readToggle(key, fallback),
    () => fallback, // Server + hydration render: React re-renders with the real value after.
  );

  const set = useCallback((next: boolean) => {
    toggleCache.set(key, next);
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // Non-fatal: the toggle still works for this session.
    }
    toggleListeners.get(key)?.forEach((listener) => listener());
  }, [key]);

  return [value, set];
}

// Which optional localization overlay an entity belongs to. Stamped on the entity as the
// `overlay` property so one effect can flip visibility for a whole group without knowing
// how any of them were built.
type OverlayKind = 'route' | 'candidate' | 'uncertainty';

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
  // Optional overlays for localized videos: the route the camera walked, the candidate
  // locations the estimator rejected, and the uncertainty disk + city-centre offset.
  // Toggling visibility flips `show` on the already-built entities instead of rebuilding
  // the datasource, so it costs one requestRender rather than a refetch + repaint. Each
  // ref mirrors its state so createVideoMarkers reads the current value at creation time.
  const [showRoutes, setShowRoutes] = usePersistentToggle('pedx.overlay.routes', true);
  const showRoutesRef = useRef(showRoutes);
  useEffect(() => { showRoutesRef.current = showRoutes; }, [showRoutes]);
  const [showCandidates, setShowCandidates] = usePersistentToggle('pedx.overlay.candidates', true);
  const showCandidatesRef = useRef(showCandidates);
  useEffect(() => { showCandidatesRef.current = showCandidates; }, [showCandidates]);
  const [showUncertainty, setShowUncertainty] = usePersistentToggle('pedx.overlay.uncertainty', true);
  const showUncertaintyRef = useRef(showUncertainty);
  useEffect(() => { showUncertaintyRef.current = showUncertainty; }, [showUncertainty]);
  // Whether routes and candidate dots answer a click at all. Off, the click falls through
  // to whatever is beneath them — normally the city ellipse — which is the point: a route
  // is drawn over its own city and otherwise swallows every attempt to select that city.
  // Affects the hover labels too, since "Click to open …" is a lie once this is off.
  const [overlaysClickable, setOverlaysClickable] = usePersistentToggle('pedx.overlay.clickable', true);
  const overlaysClickableRef = useRef(overlaysClickable);
  useEffect(() => { overlaysClickableRef.current = overlaysClickable; }, [overlaysClickable]);
  // Sample-size gate: cities below their metric's minN are drawn as unranked rings. This
  // toggles their VISIBILITY only — never the threshold, which is a claim about measurement
  // precision rather than a preference. The ref is what createHeatmap reads at paint time.
  // Flipped once the Cesium viewer exists, so the hover/click effect has something to
  // depend on (assigning viewerRef does not re-render).
  const [viewerReady, setViewerReady] = useState(false);
  const [showLowConfidence, setShowLowConfidence] = useState(true);
  const showLowConfidenceRef = useRef(showLowConfidence);
  useEffect(() => { showLowConfidenceRef.current = showLowConfidence; }, [showLowConfidence]);
  // Published by createHeatmap so the legend can state the actual domain and how many
  // cities were ranked, instead of implying the ramp spans everything painted.
  const [scaleInfo, setScaleInfo] = useState<{
    metric: string; ranked: number; total: number; min: number; max: number; established: boolean;
  } | null>(null);
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

    // Degenerate or non-finite domain. Number.isFinite (not isNaN) because an empty ranked
    // set yields Math.min(...[]) === +Infinity, which isNaN lets through — that fell into
    // the normalisation below and silently painted every city the LOW-end colour, which
    // looks like real data. Also returns the MIDDLE colour, as the original comment
    // promised; it used to return colorScale.min, i.e. "worst in the world".
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
      const t = 0.5;
      const lo = config.colorScale.min;
      const hi = config.colorScale.max;
      return new Cesium.Color(
        lo[0] + (hi[0] - lo[0]) * t,
        lo[1] + (hi[1] - lo[1]) * t,
        lo[2] + (hi[2] - lo[2]) * t,
        lo[3] + (hi[3] - lo[3]) * t,
      );
    }

    // Normalize value to 0-1 range
    const normalizedValue = safeNormalize(value, minValue, maxValue);
    
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
      // Silent blank globes are the hardest failure to diagnose here: a METRIC_CONFIG
      // property missing from DATA_COLUMNS yields undefined, which passes `!== null` and
      // fails isNaN, so the layer just disappears with no error anywhere.
      console.warn(`[Globe] metric ${metricType}: no city has a value for '${config.property}' under the current filters`);
      clearAll();
      // MUST publish before returning: otherwise the legend keeps the PREVIOUS paint's
      // "Scale: 1.25 – 1.51 across 6 cities" hanging over a globe with nothing on it, and
      // the metric name matches so the staleness check does not catch it.
      setScaleInfo({ metric: metricType, ranked: 0, total: 0, min: NaN, max: NaN, established: false });
      return;
    }

    // ---- Sample-size gate -------------------------------------------------------------
    // A city is RANKED only when its sample column is at or above the metric's minN.
    // Unranked cities are still painted (they have a real number) but as rings, and they
    // are excluded from the colour domain so one 3-crosser city cannot define the ramp for
    // everyone else. Everything here runs BEFORE entities.suspendEvents() below — an early
    // return after that call would leave the EntityCollection suspended and freeze the globe.
    const rule = config.sample;
    const sampleOf = (it: any): number | null => (rule ? readNumber(it, rule.property) : null);
    // "Clears the evidence bar" — a property of the CITY.
    const meetsBar = (it: any): boolean => {
      if (!rule) return true;                    // no gate available for this metric
      const n = sampleOf(it);
      return n !== null && n >= rule.minN;       // fail closed: unknown sample => not ranked
    };

    const rankedData = validData.filter(meetsBar);
    // "There are enough qualifying cities to draw a ramp at all" — a property of the LAYER,
    // and deliberately NOT applied to ungated metrics. Conflating the two meant an ungated
    // layer filtered down to <5 cities (traffic_mortality is external reference data on 605
    // cities, crossing_speed on 564) rendered every city as an unranked ring captioned
    // "no city has enough data", which is false: those metrics have no evidence bar to fail.
    const scaleOk = rule ? rankedData.length >= MIN_RANKED_CITIES : validData.length > 0;

    // Single pass, not Math.min(...values): the API allows up to 10000 rows and spreading
    // that many arguments can blow the stack.
    let minValue = NaN;
    let maxValue = NaN;
    if (scaleOk) {
      minValue = Infinity;
      maxValue = -Infinity;
      for (const it of rankedData) {
        const v = readNumber(it, config.property);
        if (v === null) continue;
        if (v < minValue) minValue = v;
        if (v > maxValue) maxValue = v;
      }
    } else if (rule) {
      console.warn(
        `[Globe] metric ${metricType}: ${validData.length} cities have a value, ` +
        `${rankedData.length} reach n>=${rule.minN} ${rule.noun} — scale not established, all shown as rings`
      );
    }

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
      // Two distinct facts, kept separate: does THIS city clear the bar, and does the LAYER
      // have a ramp to place it on. A city can clear the bar and still not be ranked when
      // too few of its peers did — and it must not then be captioned as thin-sampled.
      const passesBar = meetsBar(item);
      const ranked = passesBar && scaleOk;
      const t = ranked ? safeNormalize(value, minValue, maxValue) : 0;
      const color = ranked
        ? getColorForMetric(value, metricType, minValue, maxValue, Cesium)
        : new Cesium.Color(...LOW_CONFIDENCE_RGBA);
      // Composite key: this is both the canvas-cache key and the entity dirty-check, and a
      // ranked and an unranked city can share an RGBA while needing different TEXTURES
      // (filled dot vs hollow ring). Without the variant suffix the cache serves the wrong
      // sprite after a metric switch.
      const styleKey = `${quantizeColorKey(color)}|${ranked ? 'r' : 'lc'}`;

      // Scale ellipse size based on city population (or default if not available)
      const population = typeof item.population === 'string' ? parseFloat(item.population) : item.population;

      // Radius: population-based, then a small intensity nudge for ranked cities only.
      // The multiplier is applied BEFORE the clamp (it used to be applied after, so a value
      // outside the domain escaped the 3-50 km bound), and `t` is reused rather than
      // recomputing an unclamped copy of the normalisation — that copy produced 0/0 = NaN
      // whenever exactly one city had a value, and because NaN !== NaN the change-detect
      // below then rewrote both axes on every subsequent repaint forever.
      let radiusMeters = 5000; // Default 5km for unknown population
      if (Number.isFinite(population as number) && (population as number) > 0) {
        // Scale: 1M people = ~10km radius, 10M = ~30km radius
        radiusMeters = Math.sqrt((population as number) / Math.PI) * 3;
      }
      if (ranked) radiusMeters *= 0.8 + t * 0.4; // 0.8 to 1.2 range
      radiusMeters = Math.max(3000, Math.min(50000, radiusMeters));
      // A NaN or negative semiMajorAxis raises a Cesium DeveloperError inside the render
      // loop, which freezes the globe rather than failing visibly.
      if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) radiusMeters = 5000;

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
      // Evidence line: how much data backs THIS metric for THIS city. Distinct from the
      // "City totals" line below, which is the city's whole corpus — that line used to be
      // labelled "Sample:", which manufactured confidence in the worst point on the layer.
      const sampleN = sampleOf(item);
      const evidenceLine = !rule
        ? (config.provenance ? `Source: ${config.provenance}` : null)
        : sampleN === null
          ? '⚠ Sample size unknown — not ranked'
          : !passesBar
            ? `⚠ Only ${sampleN.toLocaleString()} ${rule.noun} — too few to rank (need ${rule.minN})`
            : ranked
              ? `Based on ${sampleN.toLocaleString()} ${rule.noun}`
              // Clears the bar, but too few peers did to form a scale. Saying "too few to
              // rank" here would tell a city with n=86 that 86 is fewer than 10.
              : `Based on ${sampleN.toLocaleString()} ${rule.noun} — no scale: only ${rankedData.length} cit${rankedData.length === 1 ? 'y' : 'ies'} qualify`;
      const labelText = [
        `${item.city}, ${item.country}`,
        `${config.name}: ${formatMetric(value, config.unit)}`,
        evidenceLine,
        population ? `Population: ${population.toLocaleString()}` : null,
        totalVideos != null && totalPeds != null
          ? `City totals: ${totalVideos} video${totalVideos === 1 ? '' : 's'} · ${totalPeds.toLocaleString()} pedestrians`
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
        if (props?.colorKey?.getValue() !== styleKey) {
          existing.ellipse!.material = new Cesium.ImageMaterialProperty({
            image: getGradientCanvas(color),
            transparent: true,
          }) as any;
          // Unranked cities get the ring sprite and no gradient halo — the halo reads as a
          // ramp position, which is exactly the claim we are declining to make.
          (existing.billboard as any).image = ranked ? getDotCanvas(color) : getRingCanvas(color);
          (existing.ellipse as any).show = ranked;
          props.colorKey = styleKey;
        }
        if (props?.radiusMeters?.getValue() !== radiusMeters) {
          (existing.ellipse as any).semiMinorAxis = radiusMeters;
          (existing.ellipse as any).semiMajorAxis = radiusMeters;
          props.radiusMeters = radiusMeters;
        }
        (existing.label as any).text = labelText;
        props.metricValue = value;
        props.metricType = metricType;
        props.lowConfidence = !passesBar;
        existing.show = passesBar || showLowConfidenceRef.current;
        return;
      }

      // Create main ellipse (city coverage area)
      entities.add({
        id: entityId,
        show: passesBar || showLowConfidenceRef.current,
        position: Cesium.Cartesian3.fromDegrees(
          typeof item.longitude === 'string' ? parseFloat(item.longitude) : item.longitude!,
          typeof item.latitude === 'string' ? parseFloat(item.latitude) : item.latitude!,
          30 // lift slightly above ground to avoid terrain clipping
        ),
        ellipse: {
          show: ranked,
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
          image: ranked ? getDotCanvas(color) : getRingCanvas(color),
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
          colorKey: styleKey,
          // MUST be declared at creation. Cesium's PropertyBag only registers accessors for
          // keys present when the entity is built; a key first assigned during an update
          // becomes a plain expando that getValue() cannot read — which would not reproduce
          // on first load, only after a metric switch.
          lowConfidence: !passesBar,
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

    // Publish what the legend needs to describe the ramp honestly. setScaleInfo is a stable
    // setter, so this does NOT belong in createHeatmap's dep array — adding it there would
    // recreate the callback and re-trigger the repaint effect on every paint.
    setScaleInfo({
      metric: metricType,
      ranked: rankedData.length,
      total: validData.length,
      min: minValue,
      max: maxValue,
      established: scaleOk,
    });

    // Hover/click handling is NOT registered here — see the dedicated effect below.
    // It used to live in this function, which meant the whole globe (routes, video
    // markers, candidate dots, city selection) was unclickable whenever no metric was
    // selected, because this function early-returns in that case.


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

    // Read once per paint: whether route lines and candidate dots answer a click. Visibility
    // is toggled in place on existing entities, but this one is baked in at creation because
    // it changes the hover text ("Click to open …") and whether the wide invisible hit band
    // under each route is built at all, so its toggle repaints the datasource.
    const clickable = overlaysClickableRef.current;

    // Create markers for each video
    videosWithCoords.forEach((video) => {
      const lat = video.latitude ?? video.city_latitude;
      const lng = video.longitude ?? video.city_longitude;
      
      const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
      const lngNum = typeof lng === 'string' ? parseFloat(lng) : lng;
      
      if (latNum === null || lngNum === null || isNaN(latNum) || isNaN(lngNum)) {
        console.warn(`[Globe] Skipping video ${video.video_name} - invalid coordinates:`, { lat, lng });
        return;
      }

      videoDataSource.entities.add({
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
            // Deliberately not "(amber dots)": this label is baked in at paint time and
            // the candidate dots can be switched off without repainting it, so it must
            // describe the estimate rather than what is currently on screen.
            video.localization_candidates && video.localization_candidates.length > 1
              ? `${video.localization_candidates.length} candidate locations considered`
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
        // The camera's estimated ROUTE through the city (visual odometry snapped to the OSM
        // graph). These are walking-tour videos, so this is the path actually walked —
        // drawn as a ground-clamped polyline with start/end caps. Optional: `show` starts
        // from showRoutesRef and is flipped in place by the toggle effect below, so turning
        // routes off never rebuilds the datasource.
        const route = Array.isArray(video.localization_route) ? video.localization_route : [];
        // Need at least two valid points to draw a line; guard each pair because the JSONB
        // comes straight from an external estimator.
        const routeDegrees: number[] = [];
        for (const p of route) {
          const rLat = Number(p?.[0]);
          const rLon = Number(p?.[1]);
          if (Number.isFinite(rLat) && Number.isFinite(rLon) && Math.abs(rLat) <= 90 && Math.abs(rLon) <= 180) {
            routeDegrees.push(rLon, rLat); // Cesium takes lon,lat order
          }
        }
        if (routeDegrees.length >= 4) {
          const lengthM = video.localization_route_length_m;
          // Violet, deliberately NOT the amber used for localization candidates (#f59e0b)
          // or the blue used for the chosen point and its city-centre connector — three
          // different things on one map need three readable colours.
          const ROUTE_COLOUR = '#a855f7';
          const routeText = [
            `${video.video_name || 'Video'} — route walked`,
            lengthM != null ? `${Math.round(lengthM)} m` : null,
            `${routeDegrees.length / 2} points`,
            video.localization_trajectory_source ? `source: ${video.localization_trajectory_source}` : null,
            clickable ? 'Click to open the video' : null,
          ].filter(Boolean).join('\n');

          // Wide, near-invisible hit target UNDER the visible line. A 4 px ground-clamped
          // polyline is a hard thing to hit with a mouse; this gives the same click a
          // ~16 px target without thickening the mark. Alpha is low but non-zero —
          // fully transparent geometry is skipped by the pick pass. Dropped entirely when
          // overlays are not clickable: an invisible 16 px band that no longer does
          // anything would still shadow the city underneath it in the pick stack.
          if (clickable) {
            videoDataSource.entities.add({
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(routeDegrees),
                width: 16,
                material: Cesium.Color.fromCssColorString(ROUTE_COLOUR).withAlpha(0.06),
                clampToGround: true,
              },
              show: showRoutesRef.current,
              properties: { isRoute: true, overlay: 'route', videoLink: video.link, routeLabel: routeText },
            });
          }

          videoDataSource.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(routeDegrees),
              width: 4,
              material: new Cesium.PolylineOutlineMaterialProperty({
                color: Cesium.Color.fromCssColorString(ROUTE_COLOUR).withAlpha(0.95),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
                outlineWidth: 1,
              }),
              clampToGround: true,
            },
            // Visibility lives on the ENTITY, not the graphic, so one flag covers the line,
            // its caps and their hover labels together — a graphic-level `show` left stale
            // labels on screen and desynced from the entity on the next toggle.
            show: showRoutesRef.current,
            // videoLink makes the line itself open the video, same as its marker.
            properties: { isRoute: true, overlay: 'route', videoLink: video.link, routeLabel: routeText },
          });

          // Start (green) and end (red) caps, so the direction of travel is readable.
          // They carry the hover label and the click target: a polyline has no position of
          // its own, so a label on it would have nowhere to anchor.
          const caps: Array<[number, number, string, string]> = [
            [routeDegrees[0], routeDegrees[1], '#22c55e', 'start'],
            [routeDegrees[routeDegrees.length - 2], routeDegrees[routeDegrees.length - 1], '#ef4444', 'end'],
          ];
          caps.forEach(([capLon, capLat, colour, which]) => {
            videoDataSource.entities.add({
              position: Cesium.Cartesian3.fromDegrees(capLon, capLat),
              point: {
                pixelSize: 8,
                color: Cesium.Color.fromCssColorString(colour),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: markerDepthTestDistance,
              },
              show: showRoutesRef.current,
              label: {
                text: `${which === 'start' ? '▶ Start' : '■ End'} · ${routeText}`,
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
              properties: { isRoute: true, overlay: 'route', videoLink: video.link },
            });
          });
        }

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
            show: showUncertaintyRef.current,
            properties: { overlay: 'uncertainty' },
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
            show: showUncertaintyRef.current,
            properties: { overlay: 'uncertainty' },
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
              show: showCandidatesRef.current,
              label: {
                text: [
                  `Candidate #${cand.rank}${video.video_name ? ' · ' + video.video_name : ''}`,
                  streets ? `📍 ${streets}` : null,
                  cand.support != null ? `Support: ${cand.support}` : null,
                  clickable ? 'Click to open in Google Maps' : null,
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
                overlay: 'candidate',
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
      // Signals the hover/click effect that the viewer exists. A ref assignment does not
      // re-render, so without this the interaction effect has nothing to depend on.
      setViewerReady(true);

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
          console.error('Terrain provider error:', err);
        });
      } catch (_) {}

      try {
        viewer.imageryLayers.layerAdded.addEventListener((layer: any) => {
          try {
            layer.imageryProvider?.errorEvent?.addEventListener((err: any) => {
              console.error('Imagery provider error:', err);
            });
          } catch (_) {}
        });
      } catch (_) {}

      try {
        viewer.scene.renderError.addEventListener((err: any) => {
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
  // `overlaysClickable` is a dependency because, unlike the visibility toggles, it is baked
  // into the entities (hover text + the routes' invisible hit band) and cannot be flipped
  // in place. Only the selected city's videos are painted, so the rebuild is cheap.
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
  }, [cityVideos, createVideoMarkers, overlaysClickable]);

  // Overlay visibility toggles (routes / candidate dots / uncertainty + offset). Flips
  // `show` on the entities already in the datasource rather than re-running
  // createVideoMarkers, so toggling costs one repaint and never refetches. A hidden entity
  // is also skipped by the pick pass, so switching a layer off takes its clicks with it.
  //
  // Safe to run before the async paint effect has finished building a NEW datasource:
  // entities are created with these same values read from the refs, so the only thing this
  // pass can touch early is the outgoing datasource, which is about to be discarded.
  useEffect(() => {
    const viewer = viewerRef.current;
    const ds = videoDataSourceRef.current;
    if (!viewer || !ds) return;

    const visible: Record<OverlayKind, boolean> = {
      route: showRoutes,
      candidate: showCandidates,
      uncertainty: showUncertainty,
    };

    let touched = false;
    ds.entities.suspendEvents();
    for (const entity of ds.entities.values) {
      // properties is a PropertyBag; read the raw value (nothing here is time-varying).
      const kind = entity.properties?.overlay?.getValue?.() as OverlayKind | undefined;
      if (!kind || !(kind in visible)) continue;
      const next = visible[kind];
      if (entity.show === next) continue;
      entity.show = next;
      // A hidden entity can never receive the mousemove that would hide its hover label
      // again, so drop the hover here or the label stays stranded over empty ground.
      if (!next && hoveredEntityRef.current === entity) {
        if (entity.label) (entity.label.show as any) = false;
        hoveredEntityRef.current = null;
      }
      touched = true;
    }
    ds.entities.resumeEvents();
    if (touched) viewer.scene.requestRender();
  }, [showRoutes, showCandidates, showUncertainty, cityVideos]);

  // Low-confidence visibility toggle. Flips `show` on the ring entities already in the
  // heatmap datasource rather than repainting — one requestRender, no refetch, and no dep
  // threading into createHeatmap (which would recreate it and cause a full repaint loop).
  useEffect(() => {
    const viewer = viewerRef.current;
    const ds = dataSourceRef.current;
    if (!viewer || !ds) return;
    let touched = false;
    ds.entities.suspendEvents();
    for (const entity of ds.entities.values) {
      if (entity.properties?.lowConfidence?.getValue?.() !== true) continue;
      entity.show = showLowConfidence;
      touched = true;
    }
    ds.entities.resumeEvents();
    if (touched) viewer.scene.requestRender();
  }, [showLowConfidence, cityData, selectedMetrics]);

  // Hover + click handling for EVERY entity on the globe: heatmap cities, video markers,
  // route polylines and their caps, and localization candidates.
  //
  // This used to be registered inside createHeatmap, which early-returns when no metric is
  // selected — so selecting a city to look at its routes (the natural way to reach them)
  // left the globe with no ScreenSpaceEventHandler at all and nothing was clickable.
  // Registered here against the viewer's lifetime instead, so interaction does not depend
  // on whether a heatmap happens to be painted.
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    let handler: Cesium.ScreenSpaceEventHandler | null = null;
    let cancelled = false;

    (async () => {
      const Cesium = await loadCesium();
      if (cancelled || !viewerRef.current) return;

      if (heatmapHandlerRef.current) {
        heatmapHandlerRef.current.destroy();
        heatmapHandlerRef.current = null;
      }
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
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

      handler.setInputAction((event: any) => {
        // drillPick, not pick: a route is drawn over the city's heatmap ellipse and its
        // uncertainty disk, and plain pick returns only the topmost primitive — which is
        // usually the ellipse, so the click fell through to "select this city" instead of
        // opening the video. Walk the stack and take the first entity that is actionable.
        const picks: any[] = viewer.scene.drillPick(event.position, 8) || [];
        const single = viewer.scene.pick(event.position);
        if (single && !picks.includes(single)) picks.unshift(single);

        const prop = (p: any, k: string) => p?.id?.properties?.[k]?.getValue?.();

        for (const p of picks) {
          if (!Cesium.defined(p) || !p.id || !p.id.properties) continue;

          const videoLink = prop(p, 'isVideo') ? prop(p, 'videoLink') : null;
          if (videoLink) {
            window.open(`https://www.youtube.com/watch?v=${videoLink}`, '_blank', 'noopener,noreferrer');
            return;
          }
          // Routes and candidates are click-through when the user has switched their
          // interactivity off: skipping them here (rather than returning) lets the loop
          // continue to the city underneath, which is exactly what the toggle is for.
          // Read from the ref so flipping it never re-registers this handler.
          if (overlaysClickableRef.current) {
            // Route polyline or one of its start/end caps → open the same video as its marker.
            if (prop(p, 'isRoute')) {
              const routeLink = prop(p, 'videoLink');
              if (routeLink) {
                window.open(`https://www.youtube.com/watch?v=${routeLink}`, '_blank', 'noopener,noreferrer');
                return;
              }
            }
            // Localization candidate marker → open its Google Maps location
            if (prop(p, 'isCandidate')) {
              const mapsUrl = prop(p, 'mapsUrl');
              if (mapsUrl) {
                window.open(mapsUrl, '_blank', 'noopener,noreferrer');
                return;
              }
            }
          }
        }

        // Nothing actionable under the cursor: fall back to selecting the city, checked
        // last so a route/marker click is never swallowed by the ellipse beneath it.
        for (const p of picks) {
          const cityName = prop(p, 'city');
          if (cityName) {
            setSelectedCity(cityName);
            return;
          }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    })();

    return () => {
      cancelled = true;
      if (handler) {
        handler.destroy();
        if (heatmapHandlerRef.current === handler) heatmapHandlerRef.current = null;
      }
    };
  }, [viewerReady, setSelectedCity]);

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

  // How much of each overlay the selected city actually has. Only offer a control for a
  // layer that is really on the map — most videos are city-centre fallbacks with none, and
  // a checkbox that does nothing is worse than no checkbox. Mirrors createVideoMarkers'
  // paint conditions exactly, including the `localization_status === 'ok'` gate the old
  // route-only condition skipped (which offered the toggle for routes never drawn).
  const overlayCounts = useMemo(() => {
    let routes = 0, candidates = 0, uncertainty = 0;
    for (const v of cityVideos) {
      if (v.latitude == null || v.longitude == null || v.localization_status !== 'ok') continue;
      if (Array.isArray(v.localization_route) && v.localization_route.length >= 2) routes++;
      if (Array.isArray(v.localization_candidates)) {
        candidates += v.localization_candidates.filter(
          (c) => c && c.rank !== 1 && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
        ).length;
      }
      if ((v.localization_spread_m ?? 0) > 0 || (v.city_latitude != null && v.city_longitude != null)) uncertainty++;
    }
    return { routes, candidates, uncertainty };
  }, [cityVideos]);
  const hasOverlays = overlayCounts.routes > 0 || overlayCounts.candidates > 0 || overlayCounts.uncertainty > 0;
  const hasClickTargets = overlayCounts.routes > 0 || overlayCounts.candidates > 0;

  return (
    <div className="relative w-full h-full">
      <div
        ref={cesiumContainer}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
      
      
      {/* Localization overlay controls. Each row is offered only when the selected city
          actually has that layer on the map — a control that does nothing is worse than no
          control. Choices persist across reloads (see usePersistentToggle). */}
      {hasOverlays && (
        <fieldset className="absolute bottom-4 left-4 bg-black/90 backdrop-blur-sm text-white px-3 py-2.5 rounded-lg shadow-lg max-w-[17rem]">
          <legend className="text-xs font-semibold mb-2 text-gray-200">Localization overlays</legend>

          <div className="space-y-2">
            {overlayCounts.routes > 0 && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showRoutes}
                    onChange={(e) => setShowRoutes(e.target.checked)}
                    className="accent-orange-500 cursor-pointer"
                  />
                  <span className="inline-block w-4 h-1 rounded bg-purple-500 shrink-0" aria-hidden="true" />
                  <span className="text-xs">
                    Routes walked <span className="text-gray-500">({overlayCounts.routes})</span>
                  </span>
                </label>
                <div className="text-[11px] text-gray-400 mt-0.5 pl-6">
                  <span className="text-green-400">start</span> → <span className="text-red-400">end</span> of the estimated path
                </div>
              </div>
            )}

            {overlayCounts.candidates > 0 && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showCandidates}
                    onChange={(e) => setShowCandidates(e.target.checked)}
                    className="accent-orange-500 cursor-pointer"
                  />
                  <span className="inline-block w-3 h-3 rounded-full bg-amber-500 border border-white shrink-0" aria-hidden="true" />
                  <span className="text-xs">
                    Other candidates <span className="text-gray-500">({overlayCounts.candidates})</span>
                  </span>
                </label>
                <div className="text-[11px] text-gray-400 mt-0.5 pl-6">
                  Locations the estimator ranked below the chosen one
                </div>
              </div>
            )}

            {overlayCounts.uncertainty > 0 && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showUncertainty}
                    onChange={(e) => setShowUncertainty(e.target.checked)}
                    className="accent-orange-500 cursor-pointer"
                  />
                  <span className="inline-block w-3 h-3 rounded-full bg-blue-500/30 border border-blue-400 shrink-0" aria-hidden="true" />
                  <span className="text-xs">Uncertainty &amp; offset</span>
                </label>
                <div className="text-[11px] text-gray-400 mt-0.5 pl-6">
                  ± spread disk, and blue dashes back to the city centre
                </div>
              </div>
            )}
          </div>

          {hasClickTargets && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overlaysClickable}
                  onChange={(e) => setOverlaysClickable(e.target.checked)}
                  className="accent-orange-500 cursor-pointer"
                />
                <span className="text-xs">Clickable</span>
              </label>
              <div className="text-[11px] text-gray-400 mt-0.5 pl-6">
                {overlaysClickable
                  ? 'Routes open the video, candidates open Google Maps'
                  : 'Clicks pass through to the city underneath'}
              </div>
            </div>
          )}
        </fieldset>
      )}

      {/* Heatmap Legend - moved to bottom right */}
      {selectedMetrics.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-black/90 backdrop-blur-sm text-white p-4 rounded-lg text-sm shadow-lg max-w-xs">
          <div className="font-semibold mb-3 text-base">
            🗺️ {METRIC_CONFIG[selectedMetrics[0] as keyof typeof METRIC_CONFIG]?.name || selectedMetrics[0]}
          </div>
          {(() => {
            const cfg = METRIC_CONFIG[selectedMetrics[0]];
            if (!cfg) return null;
            const rule = cfg.sample;
            const info = scaleInfo && scaleInfo.metric === selectedMetrics[0] ? scaleInfo : null;
            const rgba = (c: Rgba) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;
            const lo = rgba(cfg.colorScale.min);
            const hi = rgba(cfg.colorScale.max);
            const established = info ? info.established : true;
            const fmt = (v: number) => cfg.unit === '%' ? `${(v * 100).toFixed(1)}%` : v.toFixed(2);

            return (
              <div className="space-y-2">
                {established ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Low</span>
                      {/* Rendered FROM config.colorScale. It used to be a hardcoded
                          green→yellow→red bar that matched almost no metric — on this very
                          layer the ramp runs orange→green, so the legend was inverted. */}
                      <div
                        className="w-24 h-3 rounded-full opacity-90"
                        style={{ backgroundImage: `linear-gradient(to right, ${lo}, ${hi})` }}
                      />
                      <span className="text-xs">High</span>
                    </div>
                    {info && Number.isFinite(info.min) && Number.isFinite(info.max) && (
                      <div className="text-xs text-gray-300">
                        Scale: {fmt(info.min)} – {fmt(info.max)} across {info.ranked} cit{info.ranked === 1 ? 'y' : 'ies'}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-amber-300">
                    {(info?.total ?? 0) === 0 ? (
                      <div className="font-medium">No city has a value for this metric under the current filters</div>
                    ) : (
                      <>
                        <div className="font-medium">Not enough cities to rank on this metric</div>
                        {rule && (
                          <div className="text-gray-400 mt-1">
                            Needs at least {rule.minN} {rule.noun} per city, and at least {MIN_RANKED_CITIES} such
                            cities to form a scale — {info?.total ?? 0} cit
                            {(info?.total ?? 0) === 1 ? 'y has' : 'ies have'} a value, {info?.ranked ?? 0} qualif
                            {(info?.ranked ?? 0) === 1 ? 'ies' : 'y'}.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="text-xs text-gray-300 pt-2 border-t border-gray-600">
                  <div>Unit: <span className="font-mono">{cfg.unit}</span></div>
                  <div className="mt-1 text-gray-400">Area size reflects city population</div>

                  {/* Ring = has a value, too little evidence to place on the scale. */}
                  {rule && info && info.total > info.ranked && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={showLowConfidence}
                          onChange={(e) => setShowLowConfidence(e.target.checked)}
                          className="accent-slate-300 cursor-pointer mt-0.5"
                        />
                        <span
                          className="inline-block w-3.5 h-3.5 rounded-full border-2 shrink-0 mt-0.5"
                          style={{ borderColor: rgba(LOW_CONFIDENCE_RGBA) }}
                          aria-hidden="true"
                        />
                        <span className="text-xs">
                          Low confidence — under {rule.minN} {rule.noun}
                        </span>
                      </label>
                      <div className="text-[11px] text-gray-400 mt-1 pl-6">
                        Shown as a ring: not coloured, not ranked. Hover for the count.
                        <br />
                        {/* info.ranked counts cities that CLEAR the bar, which is not the
                            same as cities actually ranked: when too few clear it, the layer
                            has no scale and NOTHING is ranked. Saying "3 of 5 are ranked"
                            over a globe of five rings contradicts both the map and the amber
                            block directly above. Filtering to North America on this metric
                            reaches that state (5 cities have a value, 3 clear n>=10). */}
                        {established
                          ? `${info.ranked} of ${info.total} cities with a value are ranked`
                          : `${info.ranked} of ${info.total} cities clear the bar — too few to form a scale, so none are ranked`}
                      </div>
                    </div>
                  )}

                  {/* Metric-specific comparability warning / provenance, where one applies */}
                  {cfg.caveat && <div className="mt-2 text-amber-300">⚠ {cfg.caveat}</div>}
                  {cfg.provenance && <div className="mt-2 text-gray-400">Source: {cfg.provenance}</div>}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}