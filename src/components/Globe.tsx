'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useFilter } from '@/contexts/FilterContext';
import { CityGlobeData } from '@/types/database';
import type * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

declare global {
  interface Window {
    CESIUM_BASE_URL: string;
  }
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

interface VideoData {
  id: number;
  video_name: string;
  link: string;
  latitude: number | null;
  longitude: number | null;
  city_latitude: number | null;
  city_longitude: number | null;
}

export default function Globe() {
  const cesiumContainer = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const dataSourceRef = useRef<Cesium.DataSource | null>(null);
  const videoDataSourceRef = useRef<Cesium.DataSource | null>(null);
  
  const {
    selectedCity,
    selectedMetrics,
    granularFilters,
    filteredCityData,
    cityData,
    setSelectedCity,
  } = useFilter();

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

  // Fetch videos for selected city
  const fetchCityVideos = useCallback(async (cityName: string): Promise<VideoData[]> => {
    try {
      const response = await fetch(`/api/cities/${encodeURIComponent(cityName)}/videos?limit=100`);
      const result = await response.json();
      console.log(`[Globe] Fetched videos for ${cityName}:`, result);
      if (result.success && result.data) {
        const videosWithCoords = result.data.filter((v: VideoData) => {
          const lat = v.latitude ?? v.city_latitude;
          const lng = v.longitude ?? v.city_longitude;
          return lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);
        });
        console.log(`[Globe] Videos with coordinates: ${videosWithCoords.length}/${result.data.length}`);
        return result.data;
      }
      return [];
    } catch (error) {
      console.error('Error fetching city videos:', error);
      return [];
    }
  }, []);

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

      // Vehicle count filters - always send the current values
      params.append('minCar', granularFilters.car[0].toString());
      params.append('maxCar', granularFilters.car[1].toString());
      
      params.append('minBus', granularFilters.bus[0].toString());
      params.append('maxBus', granularFilters.bus[1].toString());
      
      params.append('minTruck', granularFilters.truck[0].toString());
      params.append('maxTruck', granularFilters.truck[1].toString());
      
      params.append('minMotorbike', granularFilters.motorbike[0].toString());
      params.append('maxMotorbike', granularFilters.motorbike[1].toString());
      
      params.append('minBicycle', granularFilters.bicycle[0].toString());
      params.append('maxBicycle', granularFilters.bicycle[1].toString());
      
      console.log('[Globe] Vehicle filters:', {
        car: granularFilters.car,
        bus: granularFilters.bus,
        truck: granularFilters.truck,
        motorbike: granularFilters.motorbike,
        bicycle: granularFilters.bicycle
      });
      
      // Add limit parameter to fetch more cities (increased from default 100)
      params.append('limit', '1000');
      
      const queryString = params.toString();
      const url = `/api/data?${queryString}`;
      
      const response = await fetch(url);
      const result = await response.json();
      console.log('[Globe] fetchGlobalData response:', {
        url: url,
        success: result.success,
        count: result.count,
        dataLength: result.data?.length
      });
      return result.success ? result.data : [];
    } catch (error) {
      console.error('Error fetching global data:', error);
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
    const Cesium = await import('cesium');
    viewerRef.current.scene.morphTo2D(0.8);
  }, []);

  const morphTo3D = useCallback(async () => {
    if (!viewerRef.current) return;
    const Cesium = await import('cesium');
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
    
    // Remove existing data source
    if (dataSourceRef.current) {
      viewer.dataSources.remove(dataSourceRef.current);
    }

    // Create new data source
    const dataSource = new Cesium.CustomDataSource('heatmap');
    dataSourceRef.current = dataSource;

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

    if (validData.length === 0) return;

    // Calculate min/max values for color scaling
    const values = validData.map(item => {
      const rawValue = (item as any)[config.property];
      return typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
    }).filter(v => v !== null && !isNaN(v));
    
    if (values.length === 0) return;
    
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    // Create entities for each data point
    validData.forEach(item => {
      const rawValue = (item as any)[config.property];
      const value = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
      const color = getColorForMetric(value, metricType, minValue, maxValue, Cesium);
      
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

      // Create main ellipse (city coverage area)
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          typeof item.longitude === 'string' ? parseFloat(item.longitude) : item.longitude!,
          typeof item.latitude === 'string' ? parseFloat(item.latitude) : item.latitude!,
          30 // lift slightly above ground to avoid terrain clipping
        ),
        ellipse: {
          semiMinorAxis: radiusMeters,
          semiMajorAxis: radiusMeters,
          material: new Cesium.ImageMaterialProperty({
            image: createRadialGradientCanvas(color),
            transparent: true,
          }),
          heightReference: new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        // Central marker (billboard) for better visibility and to avoid terrain clipping
        billboard: {
          image: createDotCanvas(color),
          scale: 1.0,
          heightReference: new Cesium.ConstantProperty(Cesium.HeightReference.RELATIVE_TO_GROUND),
          // Pull forward in eye space to avoid local terrain clipping while still occluding behind globe
          eyeOffset: new Cesium.Cartesian3(0, 0, -5000),
          disableDepthTestDistance: 1000000,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        },
        label: {
          text: `${item.city}, ${item.country}\n${config.name}: ${value?.toFixed(2)} ${config.unit}\nPopulation: ${population ? population.toLocaleString() : 'N/A'}`,
          font: '14pt sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -60),
          show: false, // Hide by default, show on hover
          // Keep labels readable when in front hemisphere, but not through the back side of the globe
          disableDepthTestDistance: 1000000,
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
        }
      });
    });

    // Add data source to viewer
    viewer.dataSources.add(dataSource);

    // Add hover effects
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    
    handler.setInputAction((event: any) => {
      const pickedObject = viewer.scene.pick(event.endPosition);
      
      // Hide all city/heatmap labels first
      dataSource.entities.values.forEach(entity => {
        if (entity.label) {
          (entity.label.show as any) = false;
        }
      });

      // Hide all video labels
      if (videoDataSourceRef.current) {
        videoDataSourceRef.current.entities.values.forEach(entity => {
          if (entity.label) {
            (entity.label.show as any) = false;
          }
        });
      }

      // Show label for hovered entity (city or video)
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.label) {
        (pickedObject.id.label.show as any) = true;
      }
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
    console.log('[Globe] createVideoMarkers called with', videos.length, 'videos');
    
    if (!viewerRef.current) {
      console.warn('[Globe] Viewer not ready');
      return;
    }

    if (!videos.length) {
      console.log('[Globe] No videos provided, clearing markers');
      // Remove existing video data source if no videos
      if (videoDataSourceRef.current && viewerRef.current) {
        viewerRef.current.dataSources.remove(videoDataSourceRef.current);
        videoDataSourceRef.current = null;
      }
      return;
    }

    const viewer = viewerRef.current;

    // Remove existing video data source
    if (videoDataSourceRef.current) {
      viewer.dataSources.remove(videoDataSourceRef.current);
    }

    // Create new data source for videos
    const videoDataSource = new Cesium.CustomDataSource('videos');
    videoDataSourceRef.current = videoDataSource;

    // Filter videos that have coordinates (either video-specific or city fallback)
    const videosWithCoords = videos.filter(video => {
      const lat = video.latitude ?? video.city_latitude;
      const lng = video.longitude ?? video.city_longitude;
      const hasCoords = lat !== null && lng !== null && !isNaN(Number(lat)) && !isNaN(Number(lng));
      if (!hasCoords) {
        console.warn('[Globe] Video without coordinates:', video.video_name, { lat, lng, video_lat: video.latitude, video_lng: video.longitude, city_lat: video.city_latitude, city_lng: video.city_longitude });
      }
      return hasCoords;
    });

    console.log(`[Globe] Creating markers for ${videosWithCoords.length} videos with coordinates`);

    if (videosWithCoords.length === 0) {
      console.warn('[Globe] No videos with coordinates found');
      return;
    }

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

      console.log(`[Globe] Creating marker ${index + 1}/${videosWithCoords.length} for ${video.video_name} at (${latNum}, ${lngNum})`);

      const entity = videoDataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          lngNum,
          latNum,
          50 // Slightly above ground
        ),
        billboard: {
          image: createVideoDotCanvas(),
          scale: 1.0,
          heightReference: new Cesium.ConstantProperty(Cesium.HeightReference.RELATIVE_TO_GROUND),
          eyeOffset: new Cesium.Cartesian3(0, 0, -1000),
          disableDepthTestDistance: 1000000,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        },
        label: {
          text: `${video.video_name}\n${video.link}\nClick to open video`,
          font: '12pt sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -40),
          show: false, // Hide by default, show on hover
          disableDepthTestDistance: 1000000,
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
    });

    // Add data source to viewer
    viewer.dataSources.add(videoDataSource);
    console.log(`[Globe] Added ${videosWithCoords.length} video markers to globe`);

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
    
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
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

    console.log(`Zooming to ${cityName}: lat=${lat}, lng=${lng}, altitude=${altitude}`);

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

    console.log(`Adjusted coordinates: original lat=${lat}, adjusted lat=${adjustedLat}, offset=${latOffsetDegrees}`);

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

  // Initialize Cesium
  useEffect(() => {
    const initCesium = async () => {
      if (!cesiumContainer.current) {
        console.warn('Cesium container not ready, retrying...');
        setTimeout(initCesium, 100);
        return;
      }

      window.CESIUM_BASE_URL = '/cesium/';

      const Cesium = await import('cesium');

      Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiY2FhOThlNi1iNDMwLTQyYTQtYmNjNy0zNGMyYzIwNTg1YTUiLCJpZCI6MzQxNDgwLCJpYXQiOjE3NTc5MzY2Mzh9.ATR_-WPV_pD-R9uod-sFaDzlzDYM0f-MlmGRFg393d4';

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

          // If a metric is active, rebuild the heatmap to ensure perfect alignment in new mode
          try {
            if (selectedMetrics.length > 0) {
              const data = await fetchGlobalData();
              await createHeatmap(data, selectedMetrics[0], Cesium, setSelectedCity);
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
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
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
      }
      return;
    }

    // Debounce updates to prevent flickering when filters change rapidly
    const timeoutId = setTimeout(async () => {
      try {
        console.log('[Globe] Updating heatmap - useEffect triggered', {
          selectedMetrics,
          vehicleFilters: {
            car: granularFilters.car,
            bus: granularFilters.bus,
            truck: granularFilters.truck,
            motorbike: granularFilters.motorbike,
            bicycle: granularFilters.bicycle
          },
          vehicleFiltersKey,
          timestamp: new Date().toISOString()
        });
        const data = await fetchGlobalData();
        console.log('[Globe] Fetched data count:', data.length);
        if (data.length === 0) {
          console.warn('[Globe] No data returned from API - check filters');
        }
        const Cesium = await import('cesium');
        
        // Use the first selected metric for heatmap
        const metricType = selectedMetrics[0];
        console.log('[Globe] Creating heatmap with', data.length, 'cities for metric:', metricType);
        await createHeatmap(data, metricType, Cesium, setSelectedCity);
        console.log('[Globe] Heatmap created successfully');
      } catch (error) {
        console.error('[Globe] Error updating heatmap:', error);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [
    selectedMetrics, 
    vehicleFiltersKey,
    clothingFiltersKey,
    createHeatmap, 
    fetchGlobalData, 
    setSelectedCity
  ]);

  // Handle city selection changes and load video markers
  useEffect(() => {
    if (!viewerRef.current || !selectedCity) {
      // Clear video markers when no city is selected
      if (videoDataSourceRef.current && viewerRef.current) {
        viewerRef.current.dataSources.remove(videoDataSourceRef.current);
        videoDataSourceRef.current = null;
      }
      return;
    }

    const handleCityZoomAndVideos = async () => {
      const Cesium = await import('cesium');
      
      // Zoom to city
      await zoomToCity(selectedCity, Cesium);
      
      // Fetch and display video markers
      const videos = await fetchCityVideos(selectedCity);
      await createVideoMarkers(videos, Cesium);
    };

    handleCityZoomAndVideos();
  }, [selectedCity, zoomToCity, fetchCityVideos, createVideoMarkers]);

  // Listen for globe reset event
  useEffect(() => {
    const resetGlobe = async () => {
      if (!viewerRef.current) return;
      
      const Cesium = await import('cesium');
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