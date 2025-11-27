"use client"

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { Badge } from "@/components/ui/badge"
import { FilterSidebar } from "@/components/filter-sidebar"
import { InfoSidebar } from "@/components/info-sidebar"
import { FilterProvider, useFilter } from "@/contexts/FilterContext"
import Globe from "@/components/Globe";
import { useState } from "react";
import { X } from "lucide-react";

function MainContent({ isInfoSidebarOpen, setIsInfoSidebarOpen }: { 
  isInfoSidebarOpen: boolean; 
  setIsInfoSidebarOpen: (open: boolean) => void;
}) {
  const { 
    selectedCity, 
    selectedMetrics, 
    granularFilters, 
    setSelectedCity, 
    setSelectedMetrics,
    updateGranularFilter,
    resetGranularFilters 
  } = useFilter();

  // Get active filters for badge display
  const getActiveFilterBadges = () => {
    const badges = [];

    if (selectedCity) {
      badges.push({ type: 'city', label: selectedCity, key: 'city' });
    }

    if (selectedMetrics.length > 0) {
      badges.push({ type: 'metric', label: selectedMetrics[0].replace(/_/g, ' '), key: 'metric' });
    }

    if (granularFilters.continents.length > 0) {
      granularFilters.continents.forEach((c, i) => 
        badges.push({ type: 'continent', label: c, key: `continent-${i}` })
      );
    }

    if (granularFilters.weather.length > 0) {
      granularFilters.weather.forEach((w, i) => 
        badges.push({ type: 'weather', label: w, key: `weather-${i}` })
      );
    }

    if (granularFilters.gender.length > 0) {
      granularFilters.gender.forEach((g, i) => 
        badges.push({ type: 'gender', label: g, key: `gender-${i}` })
      );
    }

    // Pedestrian Behavior filters
    if (granularFilters.riskyCrossing === true) {
      badges.push({ type: 'riskyCrossing', label: 'Risky Crossing', key: 'risky-crossing' });
    }
    if (granularFilters.runRedLight === true) {
      badges.push({ type: 'runRedLight', label: 'Run Red Light', key: 'run-red-light' });
    }
    if (granularFilters.crosswalkUse === true) {
      badges.push({ type: 'crosswalkUse', label: 'Crosswalk Use', key: 'crosswalk-use' });
    }

    // Clothing & Accessories
    if (granularFilters.phoneUse === true) {
      badges.push({ type: 'phoneUse', label: 'Phone Use', key: 'phone-use' });
    }
    if (granularFilters.backpack === true) {
      badges.push({ type: 'backpack', label: 'Backpack', key: 'backpack' });
    }
    if (granularFilters.umbrella === true) {
      badges.push({ type: 'umbrella', label: 'Umbrella', key: 'umbrella' });
    }
    if (granularFilters.handbag === true) {
      badges.push({ type: 'handbag', label: 'Handbag', key: 'handbag' });
    }
    if (granularFilters.suitcase === true) {
      badges.push({ type: 'suitcase', label: 'Suitcase', key: 'suitcase' });
    }

    if (granularFilters.shirtType.length > 0) {
      granularFilters.shirtType.forEach((s, i) => 
        badges.push({ type: 'shirtType', label: s.replace('-', ' '), key: `shirt-${i}` })
      );
    }

    if (granularFilters.bottomWear.length > 0) {
      granularFilters.bottomWear.forEach((b, i) => 
        badges.push({ type: 'bottomWear', label: b, key: `bottom-${i}` })
      );
    }

    // Vehicle count filters (only show if not at default range)
    if (granularFilters.car[0] > 0 || granularFilters.car[1] < 500) {
      badges.push({ 
        type: 'car', 
        label: `Car ${granularFilters.car[0]}-${granularFilters.car[1]}`, 
        key: 'car-range' 
      });
    }

    if (granularFilters.bus[0] > 0 || granularFilters.bus[1] < 100) {
      badges.push({ 
        type: 'bus', 
        label: `Bus ${granularFilters.bus[0]}-${granularFilters.bus[1]}`, 
        key: 'bus-range' 
      });
    }

    if (granularFilters.truck[0] > 0 || granularFilters.truck[1] < 100) {
      badges.push({ 
        type: 'truck', 
        label: `Truck ${granularFilters.truck[0]}-${granularFilters.truck[1]}`, 
        key: 'truck-range' 
      });
    }

    if (granularFilters.motorbike[0] > 0 || granularFilters.motorbike[1] < 200) {
      badges.push({ 
        type: 'motorbike', 
        label: `Motorbike ${granularFilters.motorbike[0]}-${granularFilters.motorbike[1]}`, 
        key: 'motorbike-range' 
      });
    }

    if (granularFilters.bicycle[0] > 0 || granularFilters.bicycle[1] < 300) {
      badges.push({ 
        type: 'bicycle', 
        label: `Bicycle ${granularFilters.bicycle[0]}-${granularFilters.bicycle[1]}`, 
        key: 'bicycle-range' 
      });
    }

    // Add range filters if not default
    if (granularFilters.ageRange[0] > 0 || granularFilters.ageRange[1] < 100) {
      badges.push({ 
        type: 'age', 
        label: `Age ${granularFilters.ageRange[0]}-${granularFilters.ageRange[1]}`, 
        key: 'age-range' 
      });
    }

    if (granularFilters.population[0] > 0 || granularFilters.population[1] < 50000000) {
      const min = (granularFilters.population[0] / 1000000).toFixed(1);
      const max = (granularFilters.population[1] / 1000000).toFixed(1);
      badges.push({ 
        type: 'population', 
        label: `Pop ${min}M-${max}M`, 
        key: 'population-range' 
      });
    }

    if (granularFilters.crossingSpeed[0] > 0 || granularFilters.crossingSpeed[1] < 5) {
      badges.push({ 
        type: 'crossingSpeed', 
        label: `Speed ${granularFilters.crossingSpeed[0]}-${granularFilters.crossingSpeed[1]}m/s`, 
        key: 'speed-range' 
      });
    }

    if (granularFilters.avgRoadWidth[0] > 0 || granularFilters.avgRoadWidth[1] < 50) {
      badges.push({ 
        type: 'roadWidth', 
        label: `Road ${granularFilters.avgRoadWidth[0]}-${granularFilters.avgRoadWidth[1]}m`, 
        key: 'road-width' 
      });
    }

    return badges;
  };

  const removeBadge = (badge: any) => {
    if (badge.type === 'city') {
      setSelectedCity(null);
    } else if (badge.type === 'metric') {
      setSelectedMetrics([]);
    } else if (badge.type === 'continent') {
      const newContinents = granularFilters.continents.filter(c => c !== badge.label);
      updateGranularFilter('continents', newContinents);
    } else if (badge.type === 'weather') {
      const newWeather = granularFilters.weather.filter(w => w !== badge.label);
      updateGranularFilter('weather', newWeather);
    } else if (badge.type === 'gender') {
      const newGender = granularFilters.gender.filter(g => g !== badge.label);
      updateGranularFilter('gender', newGender);
    } else if (badge.type === 'age') {
      updateGranularFilter('ageRange', [0, 100]);
    } else if (badge.type === 'population') {
      updateGranularFilter('population', [0, 50000000]);
    } else if (badge.type === 'crossingSpeed') {
      updateGranularFilter('crossingSpeed', [0, 5]);
    } else if (badge.type === 'roadWidth') {
      updateGranularFilter('avgRoadWidth', [0, 50]);
    } 
    // Pedestrian Behavior
    else if (badge.type === 'riskyCrossing') {
      updateGranularFilter('riskyCrossing', null);
    } else if (badge.type === 'runRedLight') {
      updateGranularFilter('runRedLight', null);
    } else if (badge.type === 'crosswalkUse') {
      updateGranularFilter('crosswalkUse', null);
    }
    // Clothing & Accessories
    else if (badge.type === 'phoneUse') {
      updateGranularFilter('phoneUse', null);
    } else if (badge.type === 'backpack') {
      updateGranularFilter('backpack', null);
    } else if (badge.type === 'umbrella') {
      updateGranularFilter('umbrella', null);
    } else if (badge.type === 'handbag') {
      updateGranularFilter('handbag', null);
    } else if (badge.type === 'suitcase') {
      updateGranularFilter('suitcase', null);
    } else if (badge.type === 'shirtType') {
      const newShirtType = granularFilters.shirtType.filter(s => s.replace('-', ' ') !== badge.label);
      updateGranularFilter('shirtType', newShirtType);
    } else if (badge.type === 'bottomWear') {
      const newBottomWear = granularFilters.bottomWear.filter(b => b !== badge.label);
      updateGranularFilter('bottomWear', newBottomWear);
    }
    // Vehicle count filters
    else if (badge.type === 'car') {
      updateGranularFilter('car', [0, 500]);
    } else if (badge.type === 'bus') {
      updateGranularFilter('bus', [0, 100]);
    } else if (badge.type === 'truck') {
      updateGranularFilter('truck', [0, 100]);
    } else if (badge.type === 'motorbike') {
      updateGranularFilter('motorbike', [0, 200]);
    } else if (badge.type === 'bicycle') {
      updateGranularFilter('bicycle', [0, 300]);
    }
  };

  const activeBadges = getActiveFilterBadges();

  return (
    <ResizablePanelGroup direction="horizontal" className="flex-1">
      {/* Main Content Area */}
      <ResizablePanel 
        defaultSize={isInfoSidebarOpen ? 75 : 100} 
        minSize={50} 
        className="flex flex-col"
      >
        <SidebarInset className="flex flex-col h-screen">
          {/* Top Bar with Sidebar Triggers */}
          <div className="h-12 border-b flex items-center justify-between px-4 flex-shrink-0">
            <div className="flex items-center gap-3 flex-1 overflow-hidden">
              <SidebarTrigger />
              <h1 className="text-lg font-semibold whitespace-nowrap">PedX Visualizer</h1>
              
              {/* Active Filter Badges */}
              <div className="flex items-center gap-2 overflow-x-auto">
                {activeBadges.map((badge) => (
                  <Badge 
                    key={badge.key} 
                    variant="secondary" 
                    className="flex items-center gap-1 text-xs capitalize cursor-pointer hover:bg-secondary/80"
                    onClick={() => removeBadge(badge)}
                  >
                    {badge.label}
                    <X className="w-3 h-3" />
                  </Badge>
                ))}
              </div>
            </div>
            <button
              onClick={() => setIsInfoSidebarOpen(!isInfoSidebarOpen)}
              className="flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Info</span>
              <svg
                className={`w-4 h-4 transition-transform ${isInfoSidebarOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          
          {/* Cesium Globe - Fixed height based on viewport */}
          <div className="relative overflow-hidden flex-1">
            <Globe />
          </div>
        </SidebarInset>
      </ResizablePanel>

      {/* Resizable Handle - Only show when sidebar is open */}
      {isInfoSidebarOpen && <ResizableHandle withHandle />}

      {/* Right Info Sidebar - Collapsible and Resizable */}
      {isInfoSidebarOpen && (
        <ResizablePanel defaultSize={25} minSize={20} maxSize={50}>
          <InfoSidebar />
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}

export default function Home() {
  const [isInfoSidebarOpen, setIsInfoSidebarOpen] = useState(true);

  return (
    <FilterProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          {/* Left Filter Sidebar - Pushes Content */}
          <FilterSidebar />
          
          {/* Main Content with Filter Context */}
          <MainContent 
            isInfoSidebarOpen={isInfoSidebarOpen} 
            setIsInfoSidebarOpen={setIsInfoSidebarOpen} 
          />
        </div>
      </SidebarProvider>
    </FilterProvider>
  );
}
