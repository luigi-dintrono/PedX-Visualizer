'use client';

import { useEffect, useRef } from 'react';
import type * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

declare global {
  interface Window {
    CESIUM_BASE_URL: string;
  }
}

export default function Globe() {
  const cesiumContainer = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  useEffect(() => {
    const initCesium = async () => {
      // Wait for the container to be available
      if (!cesiumContainer.current) {
        console.warn('Cesium container not ready, retrying...');
        setTimeout(initCesium, 100);
        return;
      }

      // Set Cesium base URL before importing
      window.CESIUM_BASE_URL = '/cesium/';

      // Dynamic import of Cesium
      const Cesium = await import('cesium');

      // Configure Cesium with the provided token
      Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiY2FhOThlNi1iNDMwLTQyYTQtYmNjNy0zNGMyYzIwNTg1YTUiLCJpZCI6MzQxNDgwLCJpYXQiOjE3NTc5MzY2Mzh9.ATR_-WPV_pD-R9uod-sFaDzlzDYM0f-MlmGRFg393d4';

      // Create viewer with basic configuration
      const viewer = new Cesium.Viewer(cesiumContainer.current, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
      });

      // Store viewer reference
      viewerRef.current = viewer;

      // Fly the camera to San Francisco
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-122.4175, 37.655, 400),
        orientation: {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(-15.0),
        }
      });

      // Add Cesium OSM Buildings
      try {
        const buildingTileset = await Cesium.createOsmBuildingsAsync();
        viewer.scene.primitives.add(buildingTileset);
      } catch (error) {
        console.warn('Could not load OSM Buildings:', error);
      }
    };

    // Add a small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      initCesium().catch(console.error);
    }, 100);

    // Handle window resize to ensure Cesium resizes properly
    const handleResize = () => {
      if (viewerRef.current) {
        viewerRef.current.resize();
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={cesiumContainer}
      className="w-full h-full"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
