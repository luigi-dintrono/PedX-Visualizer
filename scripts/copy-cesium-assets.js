#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const cesiumPath = path.join(__dirname, '../node_modules/cesium');
const publicCesiumPath = path.join(__dirname, '../public/cesium');

// Create public/cesium directory if it doesn't exist
if (!fs.existsSync(publicCesiumPath)) {
  fs.mkdirSync(publicCesiumPath, { recursive: true });
}

// Copy Cesium Assets
const cesiumAssetsPath = path.join(cesiumPath, 'Build/Cesium/Assets');
const publicAssetsPath = path.join(publicCesiumPath, 'Assets');

if (fs.existsSync(cesiumAssetsPath)) {
  if (fs.existsSync(publicAssetsPath)) {
    fs.rmSync(publicAssetsPath, { recursive: true, force: true });
  }
  fs.cpSync(cesiumAssetsPath, publicAssetsPath, { recursive: true });
  console.log('✓ Copied Cesium Assets');
} else {
  console.warn('⚠ Cesium Assets directory not found');
}

// Copy Cesium Widgets Images
const cesiumWidgetsImagesPath = path.join(cesiumPath, 'Build/Cesium/Widgets/Images');
const publicWidgetsImagesPath = path.join(publicCesiumPath, 'Widgets/Images');

if (fs.existsSync(cesiumWidgetsImagesPath)) {
  if (fs.existsSync(publicWidgetsImagesPath)) {
    fs.rmSync(publicWidgetsImagesPath, { recursive: true, force: true });
  }
  fs.cpSync(cesiumWidgetsImagesPath, publicWidgetsImagesPath, { recursive: true });
  console.log('✓ Copied Cesium Widgets Images');
} else {
  console.warn('⚠ Cesium Widgets Images directory not found');
}

// Copy Cesium ThirdParty
const cesiumThirdPartyPath = path.join(cesiumPath, 'Build/Cesium/ThirdParty');
const publicThirdPartyPath = path.join(publicCesiumPath, 'ThirdParty');

if (fs.existsSync(cesiumThirdPartyPath)) {
  if (fs.existsSync(publicThirdPartyPath)) {
    fs.rmSync(publicThirdPartyPath, { recursive: true, force: true });
  }
  fs.cpSync(cesiumThirdPartyPath, publicThirdPartyPath, { recursive: true });
  console.log('✓ Copied Cesium ThirdParty');
} else {
  console.warn('⚠ Cesium ThirdParty directory not found');
}

// Copy Cesium Widgets
const cesiumWidgetsPath = path.join(cesiumPath, 'Build/Cesium/Widgets');
const publicWidgetsPath = path.join(publicCesiumPath, 'Widgets');

if (fs.existsSync(cesiumWidgetsPath)) {
  if (fs.existsSync(publicWidgetsPath)) {
    fs.rmSync(publicWidgetsPath, { recursive: true, force: true });
  }
  fs.cpSync(cesiumWidgetsPath, publicWidgetsPath, { recursive: true });
  console.log('✓ Copied Cesium Widgets');
} else {
  console.warn('⚠ Cesium Widgets directory not found');
}

// Copy Cesium Workers
const cesiumWorkersPath = path.join(cesiumPath, 'Build/Cesium/Workers');
const publicWorkersPath = path.join(publicCesiumPath, 'Workers');

if (fs.existsSync(cesiumWorkersPath)) {
  if (fs.existsSync(publicWorkersPath)) {
    fs.rmSync(publicWorkersPath, { recursive: true, force: true });
  }
  fs.cpSync(cesiumWorkersPath, publicWorkersPath, { recursive: true });
  console.log('✓ Copied Cesium Workers');
} else {
  console.warn('⚠ Cesium Workers directory not found');
}

console.log('✓ Cesium assets copied to /public/cesium');
