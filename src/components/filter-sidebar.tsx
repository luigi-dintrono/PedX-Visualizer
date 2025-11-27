"use client"

import { 
  RefreshCw, 
  Check, 
  ChevronsUpDown, 
  Globe, 
  Cloud, 
  Users, 
  User, 
  Shirt,
  Car,
  Search,
  Activity,
  AlertTriangle,
  Zap,
  Shield,
  Smartphone,
  Gauge,
  Clock,
  Move
} from "lucide-react"
import { useState } from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useFilter, GranularFilters } from "@/contexts/FilterContext"

// Behavior metrics configuration
const BEHAVIOR_METRICS = [
  {
    value: 'risky_crossing',
    label: 'Risky Crossing Rate',
    description: 'Pedestrians crossing unsafely',
    icon: AlertTriangle,
  },
  {
    value: 'run_red_light',
    label: 'Run Red Light Rate',
    description: 'Ignoring traffic signals',
    icon: Zap,
  },
  {
    value: 'crosswalk_usage',
    label: 'Crosswalk Usage Rate',
    description: 'Using designated crossings',
    icon: Shield,
  },
  {
    value: 'phone_usage',
    label: 'Phone Usage Rate',
    description: 'Distracted by phones',
    icon: Smartphone,
  },
  {
    value: 'crossing_speed',
    label: 'Crossing Speed',
    description: 'Average speed while crossing',
    icon: Gauge,
  },
  {
    value: 'crossing_time',
    label: 'Crossing Time',
    description: 'Duration of crossing',
    icon: Clock,
  },
  {
    value: 'avg_age',
    label: 'Average Age',
    description: 'Demographics of pedestrians',
    icon: User,
  },
  {
    value: 'pedestrian_density',
    label: 'Pedestrian Density',
    description: 'Crowding effects',
    icon: Users,
  },
  {
    value: 'road_width',
    label: 'Road Width',
    description: 'Infrastructure impact',
    icon: Move,
  },
] as const;

export function FilterSidebar() {
  const {
    selectedCity,
    selectedMetrics,
    granularFilters,
    cityData,
    metricData,
    loading,
    setSelectedCity,
    setSelectedMetrics,
    updateGranularFilter,
    resetGranularFilters,
    applyFilters,
  } = useFilter()

  // State for city search dropdown
  const [citySearchOpen, setCitySearchOpen] = useState(false)
  const [behaviorSearchOpen, setBehaviorSearchOpen] = useState(false)

  // Alias for easier access
  const filters = granularFilters

  // Legacy setFilters wrapper - updates context instead (unused but kept for compatibility)
  // const setFilters = (updater: (filters: GranularFilters) => GranularFilters) => {
  //   if (typeof updater === 'function') {
  //     const newFilters = updater(granularFilters)
  //     Object.entries(newFilters).forEach(([key, value]) => {
  //       updateGranularFilter(key as keyof typeof granularFilters, value)
  //     })
  //   }
  // }


  // Get unique cities from the data, excluding cities with 0 videos or 0 pedestrians
  const uniqueCities = Array.from(
    new Set(
      cityData
        .filter(city => {
          const videos = typeof city.total_videos === 'number' ? city.total_videos : (parseInt(String(city.total_videos)) || 0);
          const pedestrians = typeof city.total_pedestrians === 'number' ? city.total_pedestrians : (parseInt(String(city.total_pedestrians)) || 0);
          return videos > 0 && pedestrians > 0;
        })
        .map(city => city.city)
    )
  ).sort()

  const handleCitySelect = (cityName: string) => {
    const newSelectedCity = cityName === "all" ? null : cityName
    setSelectedCity(newSelectedCity)
    setCitySearchOpen(false)
    
    // If "All Cities" is selected, reset globe to original position
    if (cityName === "all") {
      // Trigger a globe reset event - this will be handled by the Globe component
      window.dispatchEvent(new CustomEvent('resetGlobe'))
    }
    // applyFilters will be called automatically by the useEffect in FilterContext
  }

  const handleBehaviorSelect = (behavior: string) => {
    const newSelectedBehavior = behavior === "all" ? [] : [behavior]
    setSelectedMetrics(newSelectedBehavior)
    setBehaviorSearchOpen(false)
  }

  const updateFilter = <K extends keyof GranularFilters>(key: K, value: GranularFilters[K]) => {
    updateGranularFilter(key, value)
  }

  const toggleArrayFilter = (key: string, value: string) => {
    const current = granularFilters[key as keyof typeof granularFilters] as string[]
    const newArray = current.includes(value) 
      ? current.filter(item => item !== value)
      : [...current, value]
    updateGranularFilter(key as keyof typeof granularFilters, newArray)
  }

  const resetFilters = () => {
    resetGranularFilters()
  }

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Filters</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="p-4 space-y-6">
              {/* Search Cities */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Search by city...
                </label>
                
                <div className="relative">
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={citySearchOpen}
                    className="w-full justify-between text-left font-normal"
                    onClick={() => setCitySearchOpen(!citySearchOpen)}
                    disabled={loading}
                  >
                    <span className="truncate">
                      {selectedCity || "All Cities"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                  
                  {citySearchOpen && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-md">
                      <Command>
                        <CommandInput 
                          placeholder="Search cities..." 
                          className="h-9"
                        />
                        <CommandList className="max-h-[200px] overflow-auto">
                          <CommandEmpty>No city found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="all"
                              onSelect={() => handleCitySelect("all")}
                              className="cursor-pointer"
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  !selectedCity ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              All Cities
                            </CommandItem>
                            {uniqueCities.map((city) => (
                              <CommandItem
                                key={city}
                                value={city}
                                onSelect={() => handleCitySelect(city)}
                                className="cursor-pointer"
                              >
                                <Check
                                  className={`mr-2 h-4 w-4 ${
                                    selectedCity === city ? "opacity-100" : "opacity-0"
                                  }`}
                                />
                                {city}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </div>
                  )}
                </div>
                
                {citySearchOpen && (
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setCitySearchOpen(false)}
                  />
                )}
              </div>

              {/* Behavior Metric Search */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Search by behaviour...
                </label>
                
                <div className="relative">
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={behaviorSearchOpen}
                    className="w-full justify-between text-left font-normal"
                    onClick={() => setBehaviorSearchOpen(!behaviorSearchOpen)}
                    disabled={loading}
                  >
                    <span className="truncate">
                      {selectedMetrics.length > 0 
                        ? BEHAVIOR_METRICS.find(m => m.value === selectedMetrics[0])?.label 
                        : "All Behaviors"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                  
                  {behaviorSearchOpen && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-md">
                      <Command>
                        <CommandInput placeholder="Search behaviors..." className="h-9" />
                        <CommandList className="max-h-[300px] overflow-auto">
                          <CommandEmpty>No behavior found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="all"
                              onSelect={() => handleBehaviorSelect("all")}
                              className="cursor-pointer"
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  selectedMetrics.length === 0 ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              All Behaviors
                            </CommandItem>
                            
                            {BEHAVIOR_METRICS.map((metric) => {
                              const Icon = metric.icon
                              return (
                                <CommandItem
                                  key={metric.value}
                                  value={metric.value}
                                  onSelect={() => handleBehaviorSelect(metric.value)}
                                  className="cursor-pointer"
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${
                                      selectedMetrics[0] === metric.value ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                                  <div className="flex-1">
                                    <div className="font-medium text-sm">{metric.label}</div>
                                    <div className="text-xs text-muted-foreground">{metric.description}</div>
                                  </div>
                                </CommandItem>
                              )
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </div>
                  )}
                </div>
                
                {behaviorSearchOpen && (
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setBehaviorSearchOpen(false)}
                  />
                )}
              </div>

              {/* Granular Filters Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1 bg-border" />
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Refine Filters
                  </label>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Filter Accordion */}
                <Accordion type="single" collapsible className="w-full space-y-2">
                
                {/* City Context */}
                <AccordionItem value="city-context">
                  <AccordionTrigger className="text-sm flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    City Context
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Continent</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {['Europe', 'Asia', 'North America', 'South America', 'Africa', 'Oceania'].map(continent => (
                            <Button
                              key={continent}
                              variant={filters.continents.includes(continent) ? "default" : "outline"}
                              size="sm"
                              className="text-xs h-6"
                              onClick={() => toggleArrayFilter('continents', continent)}
                            >
                              {continent}
                            </Button>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Population</label>
                        <div className="px-2">
                          <Slider
                            value={filters.population}
                            onValueChange={(value) => updateFilter('population', value)}
                            min={0}
                            max={50000000}
                            step={100000}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.population[0].toLocaleString()}</span>
                            <span>{filters.population[1].toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Traffic Mortality filter - commented out
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Traffic Mortality (per 100k)</label>
                        <div className="px-2">
                          <Slider
                            value={filters.trafficMortality}
                            onValueChange={(value) => updateFilter('trafficMortality', value)}
                            min={0}
                            max={20}
                            step={0.1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.trafficMortality[0].toFixed(1)}</span>
                            <span>{filters.trafficMortality[1].toFixed(1)}</span>
                          </div>
                        </div>
                      </div>
                      */}
                      
                      {/* Median Age filter - commented out
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Median Age</label>
                        <div className="px-2">
                          <Slider
                            value={filters.medianAge}
                            onValueChange={(value) => updateFilter('medianAge', value)}
                            min={0}
                            max={80}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.medianAge[0]} years</span>
                            <span>{filters.medianAge[1]} years</span>
                          </div>
                        </div>
                      </div>
                      */}
                      
                      {/* Gini Index filter - commented out
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Gini Index (Inequality)</label>
                        <div className="px-2">
                          <Slider
                            value={filters.giniIndex}
                            onValueChange={(value) => updateFilter('giniIndex', value)}
                            min={0}
                            max={100}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.giniIndex[0]}</span>
                            <span>{filters.giniIndex[1]}</span>
                          </div>
                        </div>
                      </div>
                      */}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Environmental Context */}
                <AccordionItem value="environmental">
                  <AccordionTrigger className="text-sm flex items-center gap-2">
                    <Cloud className="w-4 h-4" />
                    Environmental Context
                      </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Weather</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {['shine', 'rain', 'cloudy'].map(weather => (
                            <Button
                              key={weather}
                              variant={filters.weather.includes(weather) ? "default" : "outline"}
                              size="sm"
                              className="text-xs h-6 capitalize"
                              onClick={() => toggleArrayFilter('weather', weather)}
                            >
                              {weather}
                            </Button>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Time of Day</label>
                        <div className="flex gap-2 mt-1">
                          <Button
                            variant={filters.daytime === true ? "default" : "outline"}
                            size="sm"
                            className="text-xs h-6 flex-1"
                            onClick={() => updateFilter('daytime', filters.daytime === true ? null : true)}
                          >
                            Day
                          </Button>
                          <Button
                            variant={filters.daytime === false ? "default" : "outline"}
                            size="sm"
                            className="text-xs h-6 flex-1"
                            onClick={() => updateFilter('daytime', filters.daytime === false ? null : false)}
                          >
                            Night
                          </Button>
                        </div>
                      </div>
                      
                      {/* Crosswalk Present and Sidewalk Present filters - commented out
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="crosswalk"
                            checked={filters.crosswalkPresent === true}
                            onCheckedChange={(checked) => 
                              updateFilter('crosswalkPresent', checked ? true : null)
                            }
                          />
                          <label htmlFor="crosswalk" className="text-xs">Crosswalk Present</label>
                        </div>
                          <div className="flex items-center space-x-2">
                          <Switch
                            id="sidewalk"
                            checked={filters.sidewalkPresent === true}
                              onCheckedChange={(checked) => 
                              updateFilter('sidewalkPresent', checked ? true : null)
                            }
                          />
                          <label htmlFor="sidewalk" className="text-xs">Sidewalk Present</label>
                        </div>
                      </div>
                      */}
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Avg Road Width (m)</label>
                        <div className="px-2">
                          <Slider
                            value={filters.avgRoadWidth}
                            onValueChange={(value) => updateFilter('avgRoadWidth', value)}
                            min={0}
                            max={50}
                            step={0.5}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.avgRoadWidth[0]}m</span>
                            <span>{filters.avgRoadWidth[1]}m</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Potholes, Cracks, and Police filters - commented out
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="potholes"
                            checked={filters.potholes === true}
                            onCheckedChange={(checked) => updateFilter('potholes', checked ? true : null)}
                          />
                          <label htmlFor="potholes">Potholes</label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="cracks"
                            checked={filters.cracks === true}
                            onCheckedChange={(checked) => updateFilter('cracks', checked ? true : null)}
                          />
                          <label htmlFor="cracks">Cracks</label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="police"
                            checked={filters.policeCar === true}
                            onCheckedChange={(checked) => updateFilter('policeCar', checked ? true : null)}
                          />
                          <label htmlFor="police">Police</label>
                        </div>
                      </div>
                      */}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Pedestrian Behavior */}
                <AccordionItem value="behavior">
                  <AccordionTrigger className="text-sm flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Pedestrian Behavior
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="risky"
                            checked={filters.riskyCrossing === true}
                            onCheckedChange={(checked) => updateFilter('riskyCrossing', checked ? true : null)}
                          />
                          <label htmlFor="risky">Risky Crossing</label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="redlight"
                            checked={filters.runRedLight === true}
                            onCheckedChange={(checked) => updateFilter('runRedLight', checked ? true : null)}
                          />
                          <label htmlFor="redlight">Run Red Light</label>
                        </div>
                        {/* Crosswalk Use filter - commented out
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="crosswalk-use"
                            checked={filters.crosswalkUse === true}
                            onCheckedChange={(checked) => updateFilter('crosswalkUse', checked ? true : null)}
                          />
                          <label htmlFor="crosswalk-use">Crosswalk Use</label>
                        </div>
                        */}
                      </div>
                      
                      {/* Nearby Pedestrians filter - commented out
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Nearby Pedestrians</label>
                        <div className="px-2">
                          <Slider
                            value={filters.nearbyPedestrians}
                            onValueChange={(value) => updateFilter('nearbyPedestrians', value)}
                            min={0}
                            max={20}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.nearbyPedestrians[0]}</span>
                            <span>{filters.nearbyPedestrians[1]}</span>
                          </div>
                        </div>
                      </div>
                      */}
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Crossing Speed (m/s)</label>
                        <div className="px-2">
                          <Slider
                            value={filters.crossingSpeed}
                            onValueChange={(value) => updateFilter('crossingSpeed', value)}
                            min={0}
                            max={5}
                            step={0.1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.crossingSpeed[0]} m/s</span>
                            <span>{filters.crossingSpeed[1]} m/s</span>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Time to Start (s)</label>
                        <div className="px-2">
                          <Slider
                            value={filters.timeToStart}
                            onValueChange={(value) => updateFilter('timeToStart', value)}
                            min={0}
                            max={30}
                            step={0.5}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.timeToStart[0]}s</span>
                            <span>{filters.timeToStart[1]}s</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Demographics */}
                <AccordionItem value="demographics">
                  <AccordionTrigger className="text-sm flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Demographics
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Gender</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {['male', 'female', 'unknown'].map(gender => (
                            <Button
                              key={gender}
                              variant={filters.gender.includes(gender) ? "default" : "outline"}
                              size="sm"
                              className="text-xs h-6 capitalize"
                              onClick={() => toggleArrayFilter('gender', gender)}
                            >
                              {gender}
                            </Button>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Age Range</label>
                        <div className="px-2">
                          <Slider
                            value={filters.ageRange}
                            onValueChange={(value) => updateFilter('ageRange', value)}
                            min={0}
                            max={100}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.ageRange[0]} years</span>
                            <span>{filters.ageRange[1]} years</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Literacy Rate filter - commented out
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Literacy Rate (%)</label>
                        <div className="px-2">
                          <Slider
                            value={filters.literacyRate}
                            onValueChange={(value) => updateFilter('literacyRate', value)}
                            min={0}
                            max={100}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.literacyRate[0]}%</span>
                            <span>{filters.literacyRate[1]}%</span>
                          </div>
                        </div>
                      </div>
                      */}
                      
                      {/* Avg Height filter - commented out
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Avg Height (cm)</label>
                        <div className="px-2">
                          <Slider
                            value={filters.avgHeight}
                            onValueChange={(value) => updateFilter('avgHeight', value)}
                            min={140}
                            max={200}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.avgHeight[0]} cm</span>
                            <span>{filters.avgHeight[1]} cm</span>
                          </div>
                        </div>
                      </div>
                      */}
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                {/* Clothing & Accessories */}
                <AccordionItem value="clothing">
                  <AccordionTrigger className="text-sm flex items-center gap-2">
                    <Shirt className="w-4 h-4" />
                    Clothing & Accessories
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="phone"
                            checked={filters.phoneUse === true}
                            onCheckedChange={(checked) => updateFilter('phoneUse', checked ? true : null)}
                          />
                          <label htmlFor="phone">Phone Use</label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="backpack"
                            checked={filters.backpack === true}
                            onCheckedChange={(checked) => updateFilter('backpack', checked ? true : null)}
                          />
                          <label htmlFor="backpack">Backpack</label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="umbrella"
                            checked={filters.umbrella === true}
                            onCheckedChange={(checked) => updateFilter('umbrella', checked ? true : null)}
                          />
                          <label htmlFor="umbrella">Umbrella</label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="handbag"
                            checked={filters.handbag === true}
                            onCheckedChange={(checked) => updateFilter('handbag', checked ? true : null)}
                          />
                          <label htmlFor="handbag">Handbag</label>
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Shirt Type</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {['short-sleeved', 'long-sleeved', 'vest'].map(shirt => (
                            <Button
                              key={shirt}
                              variant={filters.shirtType.includes(shirt) ? "default" : "outline"}
                              size="sm"
                              className="text-xs h-6"
                              onClick={() => toggleArrayFilter('shirtType', shirt)}
                            >
                              {shirt.replace('-', ' ')}
                            </Button>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Bottom Wear</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {['shorts', 'trousers', 'skirt'].map(bottom => (
                            <Button
                              key={bottom}
                              variant={filters.bottomWear.includes(bottom) ? "default" : "outline"}
                              size="sm"
                              className="text-xs h-6 capitalize"
                              onClick={() => toggleArrayFilter('bottomWear', bottom)}
                            >
                              {bottom}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Vehicles */}
                {/* <AccordionItem value="vehicles">
                  <AccordionTrigger className="text-sm flex items-center gap-2">
                    <Car className="w-4 h-4" />
                    Vehicles
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Car Count</label>
                        <div className="px-2">
                          <Slider
                            value={filters.car}
                            onValueChange={(value) => updateFilter('car', value)}
                            min={0}
                            max={500}
                            step={10}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.car[0]}</span>
                            <span>{filters.car[1]}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Bus Count</label>
                        <div className="px-2">
                          <Slider
                            value={filters.bus}
                            onValueChange={(value) => updateFilter('bus', value)}
                            min={0}
                            max={100}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.bus[0]}</span>
                            <span>{filters.bus[1]}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Truck Count</label>
                        <div className="px-2">
                          <Slider
                            value={filters.truck}
                            onValueChange={(value) => updateFilter('truck', value)}
                            min={0}
                            max={100}
                            step={1}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.truck[0]}</span>
                            <span>{filters.truck[1]}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Motorbike Count</label>
                        <div className="px-2">
                          <Slider
                            value={filters.motorbike}
                            onValueChange={(value) => updateFilter('motorbike', value)}
                            min={0}
                            max={200}
                            step={2}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.motorbike[0]}</span>
                            <span>{filters.motorbike[1]}</span>
                          </div>
                        </div>
              </div>

                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Bicycle Count</label>
                        <div className="px-2">
                          <Slider
                            value={filters.bicycle}
                            onValueChange={(value) => updateFilter('bicycle', value)}
                            min={0}
                            max={300}
                            step={5}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{filters.bicycle[0]}</span>
                            <span>{filters.bicycle[1]}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem> */}
                </Accordion>
              </div>

              {/* Action Buttons */}
              <div className="pt-4">
                <Button 
                  onClick={resetFilters}
                  variant="outline"
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reset All Filters
                </Button>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}