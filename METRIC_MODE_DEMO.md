# Metric Mode - Live Demo Guide

## Quick Start

1. **Launch the application:**
   ```bash
   npm run dev
   ```
   Navigate to `http://localhost:3000`

2. **Trigger Metric Mode:**
   - Look at the **left sidebar** (Filter Sidebar)
   - Find "Search by behaviour..." dropdown
   - Click it and select any metric
   - The **right sidebar** will transform into Metric Mode!

## Example User Journey

### Step 1: Starting Point (Empty Mode)
```
┌────────────────────────────────────────────────────────────────────┐
│ [☰] PedX Visualizer                                      Info [→] │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────┐                                  ┌───────────────┐ │
│  │            │         🌍 GLOBE VIEW            │               │ │
│  │  FILTER    │                                  │     EMPTY     │ │
│  │  SIDEBAR   │         (Interactive)            │     MODE      │ │
│  │            │                                  │               │ │
│  │  Search:   │                                  │   About PedX  │ │
│  │  [All]     │                                  │               │ │
│  │            │                                  │ Top Insights: │ │
│  │  Behavior: │                                  │  1. Monaco... │ │
│  │  [All]  ←  │                                  │  2. Tokyo...  │ │
│  │            │                                  │  3. Rome...   │ │
│  └────────────┘                                  └───────────────┘ │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Step 2: Click "Search by behaviour..."
```
┌────────────────────────────────────────────────────────────────────┐
│ [☰] PedX Visualizer                                      Info [→] │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────┐                                  ┌───────────────┐ │
│  │            │         🌍 GLOBE VIEW            │               │ │
│  │  FILTER    │                                  │     EMPTY     │ │
│  │  SIDEBAR   │         (Interactive)            │     MODE      │ │
│  │            │                                  │               │ │
│  │  Search:   │        ┌──────────────────┐     │   About PedX  │ │
│  │  [All]     │        │ All Behaviors    │     │               │ │
│  │            │        ├──────────────────┤     │ Top Insights: │ │
│  │  Behavior: │        │ ⚠️ Risky Cross...│     │  1. Monaco... │ │
│  │  [Dropdown]│ →      │ ⚡ Run Red Light │     │  2. Tokyo...  │ │
│  │     ▼      │        │ 🛡️ Crosswalk Use │     │  3. Rome...   │ │
│  │            │        │ 📱 Phone Usage   │     │               │ │
│  └────────────┘        │ ⚡ Crossing Speed│     └───────────────┘ │
│                        └──────────────────┘                        │
└────────────────────────────────────────────────────────────────────┘
```

### Step 3: Select "Risky Crossing Rate"
```
┌────────────────────────────────────────────────────────────────────┐
│ [☰] PedX Visualizer  🏷️ risky crossing             Info [→]      │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────┐                                  ┌───────────────┐ │
│  │            │         🌍 GLOBE VIEW            │               │ │
│  │  FILTER    │                                  │    METRIC     │ │
│  │  SIDEBAR   │    (Colors by risky rate)        │     MODE      │ │
│  │            │                                  │               │ │
│  │  Search:   │                                  │ ⚡ Risky Cross│ │
│  │  [All]     │        🔴 High Risk              │ Rate          │ │
│  │            │                                  │               │ │
│  │  Behavior: │        🟡 Medium                 │ Global: 18.5% │ │
│  │  [Risky    │                                  │               │ │
│  │   Crossing]│        🟢 Low Risk               │ 🏆 Top Cities │ │
│  │            │                                  │ #1 Rome 24.3% │ │
│  └────────────┘                                  │ #2 NY 22.1%   │ │
│                                                   │ #3 Tokyo 21.5%│ │
│                                                   │               │ │
│                                                   │ 🔗 Relations  │ │
│                                                   │ Rain+Night ↑  │ │
│                                                   └───────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### Step 4: Scroll Through Metric Mode
```
┌─────────────────────────────────────────────────┐
│ ⚡ Risky Crossing Rate                          │
│ Percentage of pedestrians crossing in unsafe... │
├─────────────────────────────────────────────────┤
│ 📊 Global: 18.5% | 47 cities                   │
├─────────────────────────────────────────────────┤
│ 📈 Top Cities                            [Scroll]│
├─────────────────────────────────────────────────┤
│ #1 🇮🇹 Rome, Italy                              │
│    24.3% ↑ 31.4% vs global | 5 videos           │
│ ─────────────────────────────────────────────── │
│ #2 🇺🇸 New York, USA                            │
│    22.1% ↑ 19.5% vs global | 8 videos           │
│ ─────────────────────────────────────────────── │
│ #3 🇯🇵 Tokyo, Japan                             │
│    21.5% ↑ 16.2% vs global | 12 videos          │
│ ─────────────────────────────────────────────── │
│ #4 🇫🇷 Paris, France                            │
│    20.8% ↑ 12.4% vs global | 6 videos           │
│ ─────────────────────────────────────────────── │
│ ... (6 more cities)                             │
├─────────────────────────────────────────────────┤
│ 🔗 Key Relationships                            │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ ☁️ Rain + Night              [↑ +12.3%]    │ │
│ │ Rain during night increases risky crossing  │ │
│ │ by 12.3%                                    │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 👤 Male                      [↑ +8.5%]     │ │
│ │ Male pedestrians show 8.5% higher risky     │ │
│ │ crossing rate                               │ │
│ └─────────────────────────────────────────────┘ │
│ ... (4 more relationships)                      │
├─────────────────────────────────────────────────┤
│ 💡 Key Insights                                 │
├─────────────────────────────────────────────────┤
│ • Rome leads with 24.3%, significantly above    │
│   the global average                            │
│ • Rain during night increases risky crossing by │
│   12.3%                                         │
│ • Data from 247 videos across 47 cities,        │
│   analyzing 15,234 pedestrian crossings         │
├─────────────────────────────────────────────────┤
│ 🌍 All Cities (47)                       [Scroll]│
├─────────────────────────────────────────────────┤
│ # │ City      │ Country │ Value │ Δ │ Videos   │
│ ──┼───────────┼─────────┼───────┼───┼──────────│
│ 1 │ Rome      │ Italy   │ 24.3% │+31│ 5       │
│ 2 │ New York  │ USA     │ 22.1% │+19│ 8       │
│ 3 │ Tokyo     │ Japan   │ 21.5% │+16│ 12      │
│ 4 │ Paris     │ France  │ 20.8% │+12│ 6       │
│ ... (scroll for 43 more rows)                   │
└─────────────────────────────────────────────────┘
```

### Step 5: Click on "Rome" in Top Cities
```
┌────────────────────────────────────────────────────────────────────┐
│ [☰] PedX Visualizer  🏷️ Rome                       Info [→]      │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────┐                                  ┌───────────────┐ │
│  │            │         🌍 GLOBE VIEW            │               │ │
│  │  FILTER    │                                  │     CITY      │ │
│  │  SIDEBAR   │    (Zoomed to Rome)              │     MODE      │ │
│  │            │                                  │               │ │
│  │  Search:   │          🔴                      │ 🇮🇹 Rome      │ │
│  │  [Rome] ←  │           ↓                      │ Italy         │ │
│  │            │         Rome                     │               │ │
│  │  Behavior: │                                  │ Pop: 2.8M     │ │
│  │  [Risky    │                                  │               │ │
│  │   Crossing]│                                  │ 📊 KPIs       │ │
│  │            │                                  │ Speed: 1.9m/s │ │
│  └────────────┘                                  │ Risky: 24.3%  │ │
│                                                   │               │ │
│                                                   │ 💡 Insights   │ │
│                                                   │ High risky... │ │
│                                                   └───────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Interactive Demo Checklist

Test these interactions to verify everything works:

### ✅ Metric Selection
- [ ] Click "Search by behaviour..." dropdown
- [ ] Hover over each metric to see descriptions
- [ ] Select "Risky Crossing Rate"
- [ ] Verify Metric Mode appears

### ✅ Top Cities Interaction
- [ ] Scroll through top 10 cities
- [ ] Hover over a city (see hover effect)
- [ ] Click on any city
- [ ] Verify switch to City Mode

### ✅ Relationships Section
- [ ] Read relationship descriptions
- [ ] Check color coding (red/blue badges)
- [ ] Verify icons match categories

### ✅ All Cities Table
- [ ] Scroll through table
- [ ] Verify sticky header stays visible
- [ ] Click on different rows
- [ ] Verify each opens City Mode

### ✅ Metric Switching
- [ ] Select "Risky Crossing Rate"
- [ ] Switch to "Crosswalk Usage Rate"
- [ ] Verify data updates
- [ ] Switch to "Crossing Speed"
- [ ] Verify units change (%, m/s, etc.)

### ✅ Filter Integration
- [ ] In Metric Mode, apply continent filter
- [ ] Verify filter chips appear in header
- [ ] Apply weather filter
- [ ] Verify chips update

### ✅ Mode Transitions
- [ ] Start in Empty Mode → Select Metric → Metric Mode
- [ ] Metric Mode → Click City → City Mode
- [ ] City Mode → Clear City → Empty Mode
- [ ] Empty Mode → Select Metric → Metric Mode

## Visual Feedback Indicators

Watch for these visual cues:

### 🎨 Colors
- **Green (↓)** = Below global average (good for negative metrics)
- **Red (↑)** = Above global average (concerning)
- **Blue** = Primary metric elements
- **Muted** = Secondary information

### ⚡ Loading States
- "Loading metric data..." message while fetching
- Skeleton screens (coming soon)

### 🎯 Interactive Elements
- **Hover**: Background color changes
- **Click**: Cursor changes to pointer
- **Active**: Border highlights

## Real Data Examples

Here's what you'll see with real data:

### Risky Crossing Rate
```
Top Cities:
1. 🇲🇨 Monaco - 32.1% (↑ 73.5% vs global)
2. 🇻🇪 Caracas - 28.7% (↑ 55.1% vs global)
3. 🇷🇴 Bucharest - 24.8% (↑ 33.9% vs global)

Relationships:
- Cloudy + Night → ↑ +26.2% risky crossing
- Rain + Night → ↑ +12.3% risky crossing
- Male → ↑ +8.5% risky crossing
```

### Crosswalk Usage Rate
```
Top Cities:
1. 🇩🇪 Munich - 92.3% (↑ 8.2% vs global)
2. 🇯🇵 Tokyo - 88.7% (↑ 4.1% vs global)
3. 🇦🇺 Sydney - 85.3% (↑ 0.1% vs global)

Relationships:
- Day → ↑ +5.2% crosswalk usage
- Rain → ↑ +3.8% crosswalk usage
- Female → ↑ +2.1% crosswalk usage
```

### Crossing Speed
```
Top Cities:
1. 🇲🇨 Monaco - 2.10 m/s (↑ 12.9% vs global)
2. 🇦🇺 Melbourne - 2.01 m/s (↑ 8.0% vs global)
3. 🇩🇪 Munich - 1.98 m/s (↑ 6.5% vs global)

Relationships:
- Bus presence → ↑ +15.3% speed increase
- Night → ↑ +8.2% speed increase
- Male → ↑ +5.1% speed increase
```

## Troubleshooting

### "Loading metric data..." forever?
- Check database connection
- Verify materialized views exist: `npm run setup-db`
- Check console for API errors

### No relationships showing?
- Verify CSV files exist in `summary_data/`
- Check file permissions
- Look for parse errors in console

### Cities not clickable?
- Check FilterContext is properly connected
- Verify `setSelectedCity` function exists
- Check for JavaScript errors

### Globe not updating colors?
- This is a future enhancement
- Globe currently shows all cities regardless of metric

## Next Steps After Testing

1. **Explore Different Metrics**: Try all 9 supported metrics
2. **Combine with Filters**: Add continent/weather filters
3. **Compare Cities**: Click through different cities to compare
4. **Review Relationships**: Understand correlations
5. **Export Data** (future): Download rankings for analysis

---

**Happy Exploring! 🎉**

The Metric Mode provides powerful insights into pedestrian behavior patterns across the globe. Use it to:
- Identify best practices from high-performing cities
- Understand risk factors and correlations
- Guide urban planning and safety improvements
- Conduct research on pedestrian behavior

For questions or issues, refer to:
- `METRIC_MODE_IMPLEMENTATION.md` for technical details
- `METRIC_MODE_DIAGRAM.md` for visual guides
- `SUMMARY.md` for complete feature list

