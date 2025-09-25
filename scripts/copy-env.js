#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const envExamplePath = path.join(__dirname, '../env.example');
const envLocalPath = path.join(__dirname, '../.env.local');

// Simple script to copy env.example to .env.local without user interaction
function copyEnvFile() {
  try {
    // Check if .env.local already exists
    if (fs.existsSync(envLocalPath)) {
      console.log('⚠️  .env.local already exists. Skipping copy.');
      return;
    }

    // Copy env.example to .env.local
    fs.copyFileSync(envExamplePath, envLocalPath);
    console.log('✅ Copied env.example to .env.local');
    console.log('📝 Remember to add your Cesium Ion token to .env.local');
  } catch (error) {
    console.error('❌ Error copying env.example:', error.message);
    process.exit(1);
  }
}

copyEnvFile();
