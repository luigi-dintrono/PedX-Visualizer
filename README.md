# PedX Visualizer

A minimal Next.js application with CesiumJS integration for 3D globe visualization and data analysis.

## Features

- **CesiumJS Integration**: Full-screen 3D globe with static asset optimization
- **shadcn/ui Components**: Modern UI with floating sidebars
- **TypeScript**: Full type safety
- **Tailwind CSS**: Utility-first styling
- **Responsive Design**: Optimized for desktop and mobile

## Quick Start

```bash
# Clone and setup
git clone <your-repo>
cd pedx-visualizer
npm install
npm run setup
npm run dev
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

This will automatically run the postinstall script to copy Cesium assets to `/public/cesium`.

### 2. Setup Environment Variables

**Option A: Interactive Setup (Recommended)**
```bash
npm run setup
```
This will:
- Copy `env.example` to `.env.local`
- Prompt you to enter your Cesium Ion token
- Guide you through getting a token if needed

**Option B: Manual Setup**
```bash
npm run copy-env
```
Then manually edit `.env.local` and add your Cesium Ion token.

**Getting a Cesium Ion Token:**
1. Visit [https://ion.cesium.com/](https://ion.cesium.com/)
2. Sign up for a free account
3. Create a new token
4. Copy the token when prompted by the setup script

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Project Structure

```
pedx-visualizer/
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main page with sidebars over globe
│   │   └── globals.css       # Global styles
│   ├── components/
│   │   ├── Globe.tsx         # Cesium globe component
│   │   └── ui/               # shadcn/ui components
│   └── lib/
│       └── utils.ts          # Utility functions
├── public/
│   └── cesium/               # Cesium static assets (auto-generated)
├── scripts/
│   └── copy-cesium-assets.js # Postinstall script
├── next.config.mjs           # Next.js configuration for Cesium
└── package.json             # Dependencies and scripts
```

## Architecture

- **Globe Component**: Client-side Cesium integration with proper cleanup
- **Sidebars**: Floating UI panels for filters and information
- **Static Assets**: Cesium assets served from `/public/cesium`
- **Webpack Configuration**: Automatic copying of Cesium Workers

## Future Enhancements

This project is designed to be extended with:

- **Database Integration**: Add APIs and database connections
- **Real-time Data**: Connect to live data sources
- **Advanced Visualizations**: Add more data visualization components
- **User Authentication**: Add user management
- **Data Export**: Implement data export functionality

## Development Notes

- The Cesium globe is configured with `requestRenderMode=true` for better performance
- Static assets are automatically copied during `npm install`
- The project uses Next.js App Router with TypeScript
- All UI components are from shadcn/ui for consistency

## Troubleshooting

If you encounter issues:

1. **Cesium not loading**: 
   - Check that your `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set correctly in `.env.local`
   - Verify the token is valid at [https://ion.cesium.com/](https://ion.cesium.com/)

2. **Assets not found**: 
   - Run `npm install` again to trigger the postinstall script
   - Check that `/public/cesium` directory exists with assets

3. **Build errors**: 
   - Ensure all dependencies are installed with `npm install`
   - Check that `.env.local` exists (run `npm run copy-env` if missing)

4. **Environment setup issues**:
   - Run `npm run setup` for interactive setup
   - Or manually copy `env.example` to `.env.local` and edit it