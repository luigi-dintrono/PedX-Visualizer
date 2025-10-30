'use client';

import { useEffect, useRef, useCallback } from 'react';
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
  
  // Create radial gradient from center to edge
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  
  // Extract RGBA values from Cesium.Color
  const r = Math.floor(color.red * 255);
  const g = Math.floor(color.green * 255);
  const b = Math.floor(color.blue * 255);
  const a = color.alpha;
  
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

export default function Globe() {
  const cesiumContainer = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const dataSourceRef = useRef<Cesium.DataSource | null>(null);
  
  const {
    selectedCity,
    selectedMetrics,
    granularFilters,
    filteredCityData,
    cityData,
    setSelectedCity,
  } = useFilter();

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

      // Vehicles
      if (granularFilters.vehiclePresence === true) {
        params.append('vehiclePresence', 'true');
      }
      
      const queryString = params.toString();
      const url = queryString ? `/api/data?${queryString}` : '/api/data';
      
      const response = await fetch(url);
      const result = await response.json();
      return result.success ? result.data : [];
    } catch (error) {
      console.error('Error fetching global data:', error);
      return [];
    }
  }, [granularFilters]);

  // Get color for metric value
  const getColorForMetric = useCallback((
    value: number | null,
    metricType: string,
    minValue: number,
    maxValue: number,
    Cesium: typeof import('cesium')
  ): Cesium.Color => {
    if (value === null) {
      return Cesium.Color.GRAY.withAlpha(0.3);
    }

    const config = METRIC_CONFIG[metricType as keyof typeof METRIC_CONFIG];
    if (!config) {
      return Cesium.Color.BLUE.withAlpha(0.6);
    }

    // Normalize value to 0-1 range
    const normalizedValue = (value - minValue) / (maxValue - minValue);
    
    // Interpolate between min and max colors
    const minColor = config.colorScale.min;
    const maxColor = config.colorScale.max;
    
    const r = minColor[0] + (maxColor[0] - minColor[0]) * normalizedValue;
    const g = minColor[1] + (maxColor[1] - minColor[1]) * normalizedValue;
    const b = minColor[2] + (maxColor[2] - minColor[2]) * normalizedValue;
    const a = minColor[3] + (maxColor[3] - minColor[3]) * normalizedValue;
    
    return new Cesium.Color(r, g, b, a);
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
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        // Central marker (billboard) for better visibility and to avoid terrain clipping
        billboard: {
          image: createDotCanvas(color),
          scale: 1.0,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
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
      
      // Hide all labels first
      dataSource.entities.values.forEach(entity => {
        if (entity.label) {
          (entity.label.show as any) = false;
        }
      });

      // Show label for hovered entity
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.label) {
        (pickedObject.id.label.show as any) = true;
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Add click handler to select city
    handler.setInputAction((event: any) => {
      const pickedObject = viewer.scene.pick(event.position);
      
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
        const cityName = pickedObject.id.properties.city?.getValue();
        if (cityName && onCityClick) {
          onCityClick(cityName);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  }, [getColorForMetric]);

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
    };
  }, []);

  // Handle metric selection changes
  useEffect(() => {
    if (!viewerRef.current || selectedMetrics.length === 0) {
      // Clear heatmap if no metrics selected
      if (dataSourceRef.current && viewerRef.current) {
        viewerRef.current.dataSources.remove(dataSourceRef.current);
        dataSourceRef.current = null;
      }
      return;
    }

    const updateHeatmap = async () => {
      const data = await fetchGlobalData();
      const Cesium = await import('cesium');
      
      // Use the first selected metric for heatmap
      const metricType = selectedMetrics[0];
      await createHeatmap(data, metricType, Cesium, setSelectedCity);
    };

    updateHeatmap();
  }, [selectedMetrics, createHeatmap, fetchGlobalData, setSelectedCity]);

  // Handle city selection changes
  useEffect(() => {
    if (!viewerRef.current || !selectedCity) return;

    const handleCityZoom = async () => {
      const Cesium = await import('cesium');
      await zoomToCity(selectedCity, Cesium);
    };

    handleCityZoom();
  }, [selectedCity, zoomToCity]);

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