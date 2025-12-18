import CopyPlugin from 'copy-webpack-plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ignore ESLint errors during production builds
    ignoreDuringBuilds: true,
  },
  typescript: {
    // ⚠️ Bypass TypeScript errors during production builds
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    // Copy Cesium Workers to public directory
    config.plugins.push(
      new CopyPlugin({
        patterns: [
          {
            from: 'node_modules/cesium/Build/Cesium/Workers',
            to: 'cesium/Workers',
          },
          {
            from: 'node_modules/cesium/Build/Cesium/ThirdParty',
            to: 'cesium/ThirdParty',
          },
        ],
      })
    );

    // Alias for Cesium
    config.resolve.alias = {
      ...config.resolve.alias,
      cesium: 'cesium',
    };

    return config;
  },
  // Enable static file serving for Cesium assets
  async rewrites() {
    return [
      {
        source: '/cesium/:path*',
        destination: '/cesium/:path*',
      },
    ];
  },
};

export default nextConfig;
