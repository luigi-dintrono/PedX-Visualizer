import CopyPlugin from 'copy-webpack-plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Note: Next 16 no longer runs ESLint during `next build` and rejects an
  // `eslint` key here, so lint must be run separately (e.g. `npx eslint .`).
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
