# Info Sidebar Modes - Visual Guide

## Mode Decision Tree

```
┌─────────────────────────────────────────────────────────────┐
│                      INFO SIDEBAR MODES                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌─────────────────────┐
                  │  Is City Selected?  │
                  └─────────────────────┘
                    │                 │
                ┌───┘                 └───┐
               YES                        NO
                │                          │
                ▼                          ▼
         ┌──────────────┐      ┌──────────────────────┐
         │  CITY MODE   │      │ Is Metric Selected?  │
         └──────────────┘      └──────────────────────┘
                                  │                 │
                              ┌───┘                 └───┐
                             YES                       NO
                              │                         │
                              ▼                         ▼
                     ┌────────────────┐        ┌──────────────┐
                     │  METRIC MODE   │        │  EMPTY MODE  │
                     └────────────────┘        └──────────────┘
```

## Mode Comparison

### 1. EMPTY MODE (No City, No Metric)
```
┌─────────────────────────────────────────────┐
│ 📊 About                                     │
├─────────────────────────────────────────────┤
│ • Welcome text                               │
│ • Description of PedX Visualizer             │
│ • How to use instructions                    │
├─────────────────────────────────────────────┤
│ 🔥 Top Insights                              │
├─────────────────────────────────────────────┤
│ 1. 🇲🇨 Monaco - Speed insight...            │
│ 2. 🇺🇸 New York - Behavior insight...       │
│ 3. 🇯🇵 Tokyo - Safety insight...            │
│ 4. 🇦🇺 Sydney - Demographic insight...      │
│ 5. 🇩🇪 Berlin - Infrastructure insight...   │
└─────────────────────────────────────────────┘
```

### 2. METRIC MODE (No City, Metric Selected) ⭐ NEW
```
┌─────────────────────────────────────────────────────────┐
│ ⚡ Risky Crossing Rate                                  │
│ Percentage of pedestrians crossing in unsafe conditions │
├─────────────────────────────────────────────────────────┤
│ 📊 Global: 18.5% | 47 cities                            │
│ 🔍 Filters: Europe, Day, Male                           │
├─────────────────────────────────────────────────────────┤
│ 📈 Top Cities                                            │
├─────────────────────────────────────────────────────────┤
│ #1 🇮🇹 Rome, Italy                                      │
│    ┗━ 24.3% ↑ 31.4% vs global | 5 videos                │
│ #2 🇺🇸 New York, USA                                    │
│    ┗━ 22.1% ↑ 19.5% vs global | 8 videos                │
│ #3 🇯🇵 Tokyo, Japan                                     │
│    ┗━ 21.5% ↑ 16.2% vs global | 12 videos               │
│ ... (7 more cities)                                      │
├─────────────────────────────────────────────────────────┤
│ 🔗 Key Relationships                                     │
├─────────────────────────────────────────────────────────┤
│ ☁️ Rain + Night                    [↑ +12.3%]          │
│    Rain during night increases risky crossing by 12.3%  │
│                                                          │
│ 👤 Male                            [↑ +8.5%]           │
│    Male pedestrians show 8.5% higher risky crossing     │
│                                                          │
│ 🚗 Bus                             [↑ +7.2%]           │
│    Presence of buses increases risk by 7.2%             │
│ ... (3 more relationships)                               │
├─────────────────────────────────────────────────────────┤
│ 💡 Key Insights                                          │
├─────────────────────────────────────────────────────────┤
│ • Rome leads with 24.3%, significantly above the        │
│   global average                                         │
│ • Rain during night increases risky crossing by 12.3%   │
│ • Data from 247 videos across 47 cities, analyzing      │
│   15,234 pedestrian crossings                           │
├─────────────────────────────────────────────────────────┤
│ 🌍 All Cities (47)                                      │
├─────────────────────────────────────────────────────────┤
│ # │ City      │ Country │ Value   │ Δ Global │ Videos  │
│───┼───────────┼─────────┼─────────┼──────────┼─────────│
│ 1 │ Rome      │ Italy   │ 24.3%   │ +31.4%   │ 5       │
│ 2 │ New York  │ USA     │ 22.1%   │ +19.5%   │ 8       │
│ 3 │ Tokyo     │ Japan   │ 21.5%   │ +16.2%   │ 12      │
│ 4 │ Paris     │ France  │ 20.8%   │ +12.4%   │ 6       │
│ ... (43 more rows, scrollable)                          │
└─────────────────────────────────────────────────────────┘
```

### 3. CITY MODE (City Selected)
```
┌─────────────────────────────────────────────┐
│ 🇺🇸 New York                                 │
│ United States | North America                │
├─────────────────────────────────────────────┤
│ Population: 8,336,817                        │
│ Location: 40.7128, -74.0060                  │
├─────────────────────────────────────────────┤
│ 📊 KPI Strip                                 │
├─────────────────────────────────────────────┤
│ ⚡ Crossing Speed: 1.86 m/s (+12% vs global)│
│ ⏱️ Time to Start: 2.3s (-8% vs global)      │
│ ⚠️ Risky Crossing: 18.5% (-5% vs global)    │
│ 🚦 Red Light Rate: 15.2% (+15% vs global)   │
│ 🛡️ Crosswalk Usage: 85.3% (+8% vs global)  │
├─────────────────────────────────────────────┤
│ 💡 Key Insights                              │
├─────────────────────────────────────────────┤
│ • High compliance with crosswalk usage       │
│ • Above-average red light violations        │
│ • Fast crossing speeds indicate confidence  │
│ • Younger demographic (avg 32 years)        │
├─────────────────────────────────────────────┤
│ 📊 Rankings                                  │
│ 📈 Environment                               │
│ 👥 Demographics                              │
│ 🚗 Vehicles                                  │
│ 🎥 Videos Analyzed (8 videos)                │
└─────────────────────────────────────────────┘
```

## User Interaction Flows

### Flow 1: Exploring a Metric
```
1. User clicks "Search by behaviour..." 
   └─> Filter sidebar opens behavior dropdown
2. User selects "Risky Crossing Rate"
   └─> Info sidebar switches to METRIC MODE
3. User sees:
   - Top cities ranked by risky crossing rate
   - Correlations with weather, demographics, vehicles
   - All cities table with rankings
4. User clicks on "Rome" in top cities list
   └─> Info sidebar switches to CITY MODE for Rome
```

### Flow 2: Comparing Cities by Metric
```
1. User in EMPTY MODE
2. User selects "Crosswalk Usage Rate" from behavior search
   └─> Info sidebar shows METRIC MODE
3. User scrolls through "All Cities" table
4. User compares values:
   - Monaco: 92.3% (+8.2% vs global)
   - Tokyo: 88.7% (+4.1% vs global)
   - New York: 85.3% (+0.1% vs global)
5. User clicks on Monaco
   └─> Info sidebar switches to CITY MODE for Monaco
```

### Flow 3: Discovering Relationships
```
1. User selects "Run Red Light Rate" metric
   └─> Info sidebar shows METRIC MODE
2. User views "Key Relationships" section:
   - "Night" → ↑ +15.3% red light violations
   - "Rain + Night" → ↑ +23.8% red light violations
   - "Male" → ↑ +12.1% red light violations
3. User applies filters:
   - Weather: Rain
   - Time: Night
4. Top cities list updates to show cities with highest
   rain + night red light violations
```

## Interactive Elements

### Clickable Elements in METRIC MODE

1. **City in Top Cities List**
   - Click → Pin city and switch to CITY MODE
   
2. **City in All Cities Table**
   - Click row → Pin city and switch to CITY MODE
   
3. **Filter Chips in Header**
   - Display active filters (read-only, managed from left sidebar)

4. **Scroll Areas**
   - Top Cities: Scrollable list (max height 300px)
   - All Cities Table: Scrollable table (max height 400px)

## Data Update Triggers

```
Metric Mode updates when:
├─ selectedMetrics changes
├─ granularFilters change (future enhancement)
└─ Database refreshes (manual refresh button)

API Calls Made:
├─ GET /api/metrics/[metric]
│   └─ Returns: metric info, global stats, all cities ranked
└─ GET /api/metrics/[metric]/relationships
    └─ Returns: correlations with environmental/demographic factors
```

## Color Coding System

```
🟢 Green (↓)  = Below global (good for negative metrics)
🔴 Red (↑)    = Above global (bad for negative metrics)
🔵 Blue       = Metric-related UI elements
⚪ Muted      = Secondary information
```

## Responsive Behavior

- **Desktop (>1024px)**: Full layout with all sections visible
- **Tablet (768-1024px)**: Scrollable sections, compact spacing
- **Mobile (<768px)**: Sidebar collapses, reopens on demand

## Accessibility Features

- ✅ Semantic HTML (table, thead, tbody)
- ✅ ARIA labels for interactive elements
- ✅ Keyboard navigation support
- ✅ Screen reader friendly
- ✅ Color + icon indicators (not color alone)
- ✅ High contrast mode compatible

## Performance Characteristics

- **Initial Load**: ~200ms (from materialized views)
- **Metric Switch**: ~150ms (API call + render)
- **City Pin**: Instant (data already in context)
- **Filter Apply**: ~100ms (frontend filtering)

## Future Enhancement Ideas

1. **Charts**: Add distribution histograms for metrics
2. **Comparison**: Multi-metric comparison view
3. **Export**: Download rankings as CSV/PDF
4. **Filters**: Apply granular filters to rankings
5. **Bookmarks**: Save favorite metric + filter combinations

