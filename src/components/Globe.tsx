'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useFilter } from '@/contexts/FilterContext';
import { CoreGlobalCrossingData } from '@/types/database';
import type * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

declare global {
  interface Window {
    CESIUM_BASE_URL: string;
  }
}

// Metric configuration for easy extensibility
const METRIC_CONFIG = {
  crossing_speed: {
    property: 'crossing_speed_avg',
    name: 'Crossing Speed',
    unit: 'm/s',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for slow (RGBA)
      max: [1, 0, 0, 0.8], // Red for fast (RGBA)
    },
  },
  time_to_start: {
    property: 'time_to_start_crossing_avg',
    name: 'Time to Start',
    unit: 's',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for quick
      max: [1, 0, 0, 0.8], // Red for slow
    },
  },
  waiting_time: {
    property: 'waiting_time_avg',
    name: 'Waiting Time',
    unit: 's',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for short wait
      max: [1, 0, 0, 0.8], // Red for long wait
    },
  },
  crossing_distance: {
    property: 'crossing_distance_avg',
    name: 'Crossing Distance',
    unit: 'm',
    colorScale: {
      min: [0, 1, 0, 0.6], // Green for short distance
      max: [1, 0, 0, 0.8], // Red for long distance
    },
  },
} as const;

export default function Globe() {
  const cesiumContainer = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const dataSourceRef = useRef<Cesium.DataSource | null>(null);
  
  const {
    selectedCity,
    selectedMetrics,
    filteredCityData,
    cityData,
  } = useFilter();

  // Fetch global data for heatmap
  const fetchGlobalData = useCallback(async (): Promise<CoreGlobalCrossingData[]> => {
    try {
      const response = await fetch('/api/data');
      const result = await response.json();
      return result.success ? result.data : [];
    } catch (error) {
      console.error('Error fetching global data:', error);
      return [];
    }
  }, []);

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
    data: CoreGlobalCrossingData[],
    metricType: string,
    Cesium: typeof import('cesium')
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
      
      // Scale point size based on value (larger for higher values)
      const normalizedValue = (value - minValue) / (maxValue - minValue);
      const pointSize = 8 + (normalizedValue * 12); // 8-20 pixel range

      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          typeof item.longitude === 'string' ? parseFloat(item.longitude) : item.longitude!,
          typeof item.latitude === 'string' ? parseFloat(item.latitude) : item.latitude!
        ),
        point: {
          pixelSize: pointSize,
          color: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${item.city}, ${item.country}\n${config.name}: ${value?.toFixed(2)} ${config.unit}`,
          font: '12pt sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -50),
          show: false, // Hide by default, show on hover
        },
        properties: {
          city: item.city,
          country: item.country,
          metricValue: value,
          metricType: metricType,
        }
      });
    });

    // Add data source to viewer
    viewer.dataSources.add(dataSource);

    // Add click handler for entity selection
    viewer.selectedEntityChanged.addEventListener(() => {
      if (viewer.selectedEntity && viewer.selectedEntity.label) {
        (viewer.selectedEntity.label.show as any) = true;
      }
    });

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

  }, [getColorForMetric]);

  // Zoom to city
  const zoomToCity = useCallback(async (cityName: string, Cesium: typeof import('cesium')) => {
    if (!viewerRef.current) return;

    const viewer = viewerRef.current;
    
    // Find city in data
    const cityInfo = cityData.find(city => city.city === cityName);
    if (!cityInfo) return;

    // Try to get coordinates from global data
    try {
      const response = await fetch(`/api/data?city=${encodeURIComponent(cityName)}`);
      const result = await response.json();
      
      if (result.success && result.data.length > 0) {
        const cityData = result.data[0];
        const lat = typeof cityData.latitude === 'string' ? parseFloat(cityData.latitude) : cityData.latitude;
        const lng = typeof cityData.longitude === 'string' ? parseFloat(cityData.longitude) : cityData.longitude;
        if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              lng,
              lat,
              10000 // 10km altitude
            ),
            duration: 2.0,
            orientation: {
              heading: Cesium.Math.toRadians(0.0),
              pitch: Cesium.Math.toRadians(-45.0),
            }
          });
          return;
        }
      }
    } catch (error) {
      console.error('Error fetching city coordinates:', error);
    }

    // Fallback: use city name to approximate location (this is a simple approach)
    // In a real app, you'd have a geocoding service
    const cityCoordinates: { [key: string]: [number, number] } = {
      'New York': [-74.006, 40.7128],
      'London': [-0.1276, 51.5074],
      'Tokyo': [139.6503, 35.6762],
      'Paris': [2.3522, 48.8566],
      'Berlin': [13.4050, 52.5200],
      'Sydney': [151.2093, -33.8688],
      'San Francisco': [-122.4194, 37.7749],
      'Los Angeles': [-118.2437, 34.0522],
      'Chicago': [-87.6298, 41.8781],
      'Toronto': [-79.3832, 43.6532],
    };

    const coords = cityCoordinates[cityName];
    if (coords) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 10000),
        duration: 2.0,
        orientation: {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(-45.0),
        }
      });
    }
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

      const viewer = new Cesium.Viewer(cesiumContainer.current, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        homeButton: true,
        sceneModePicker: true,
        baseLayerPicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
      });
      // Hide the Cesium Ion attribution
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = "none";

      viewerRef.current = viewer;

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
      await createHeatmap(data, metricType, Cesium);
    };

    updateHeatmap();
  }, [selectedMetrics, createHeatmap, fetchGlobalData]);

  // Handle city selection changes
  useEffect(() => {
    if (!viewerRef.current || !selectedCity) return;

    const handleCityZoom = async () => {
      const Cesium = await import('cesium');
      await zoomToCity(selectedCity, Cesium);
    };

    handleCityZoom();
  }, [selectedCity, zoomToCity]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={cesiumContainer}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
      
      {/* Heatmap Legend - moved to bottom right */}
      {selectedMetrics.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-black/80 text-white p-3 rounded-lg text-sm">
          <div className="font-semibold mb-2">
            {METRIC_CONFIG[selectedMetrics[0] as keyof typeof METRIC_CONFIG]?.name || selectedMetrics[0]}
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span>Low</span>
            <div className="w-8 h-2 bg-gradient-to-r from-green-500 to-red-500 rounded"></div>
            <span>High</span>
            <div className="w-4 h-4 bg-red-500 rounded"></div>
          </div>
          <div className="text-xs text-gray-300 mt-1">
            Unit: {METRIC_CONFIG[selectedMetrics[0] as keyof typeof METRIC_CONFIG]?.unit || ''}
          </div>
        </div>
      )}
    </div>
  );
}