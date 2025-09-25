#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envExamplePath = path.join(__dirname, '../env.example');
const envLocalPath = path.join(__dirname, '../.env.local');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupEnvironment() {
  console.log('🔧 Setting up environment variables...\n');

  // Check if .env.local already exists
  if (fs.existsSync(envLocalPath)) {
    console.log('⚠️  .env.local already exists. Skipping environment setup.');
    rl.close();
    return;
  }

  // Copy env.example to .env.local
  try {
    fs.copyFileSync(envExamplePath, envLocalPath);
    console.log('✅ Copied env.example to .env.local');
  } catch (error) {
    console.error('❌ Error copying env.example:', error.message);
    rl.close();
    return;
  }

  // Ask for Cesium Ion token
  console.log('\n🌍 Cesium Ion Token Setup');
  console.log('To get your Cesium Ion token:');
  console.log('1. Visit https://ion.cesium.com/');
  console.log('2. Sign up for a free account');
  console.log('3. Create a new token');
  console.log('4. Copy the token below\n');

  const token = await question('Enter your Cesium Ion token (or press Enter to skip): ');

  if (token.trim()) {
    // Read the current .env.local file
    let envContent = fs.readFileSync(envLocalPath, 'utf8');
    
    // Replace the placeholder token with the actual token
    envContent = envContent.replace(
      'NEXT_PUBLIC_CESIUM_ION_TOKEN=your_cesium_ion_token_here',
      `NEXT_PUBLIC_CESIUM_ION_TOKEN=${token.trim()}`
    );

    // Write the updated content back
    fs.writeFileSync(envLocalPath, envContent);
    console.log('✅ Cesium Ion token added to .env.local');
  } else {
    console.log('⚠️  Skipped Cesium Ion token setup. You can add it later to .env.local');
  }

  console.log('\n🎉 Environment setup complete!');
  console.log('📝 Next steps:');
  console.log('   1. Run: npm run dev');
  console.log('   2. Open: http://localhost:3000');
  console.log('   3. Add your Cesium Ion token to .env.local if you skipped it');

  rl.close();
}

// Run the setup
setupEnvironment().catch((error) => {
  console.error('❌ Setup failed:', error.message);
  rl.close();
  process.exit(1);
});
