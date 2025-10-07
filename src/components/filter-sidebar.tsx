"use client"

import { 
  MapPin, 
  RefreshCw, 
  Check, 
  ChevronsUpDown, 
  Globe, 
  Cloud, 
  Users, 
  User, 
  Shirt,
  Car,
  Search
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
import { Checkbox } from "@/components/ui/checkbox"
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
import { useFilter } from "@/contexts/FilterContext"

export function FilterSidebar() {
  const {
    selectedCity,
    selectedMetrics,
    cityData,
    metricData,
    loading,
    setSelectedCity,
    setSelectedMetrics,
    applyFilters,
  } = useFilter()

  // State for city search dropdown
  const [citySearchOpen, setCitySearchOpen] = useState(false)

  // Filter states
  const [filters, setFilters] = useState({
    // City Context
    continents: [] as string[],
    countries: [] as string[],
    population: [0, 50000000] as [number, number],
    trafficMortality: [0, 20] as [number, number],
    medianAge: [0, 80] as [number, number],
    giniIndex: [0, 100] as [number, number],
    
    // Environmental Context
    weather: [] as string[],
    daytime: null as boolean | null,
    crosswalkPresent: null as boolean | null,
    sidewalkPresent: null as boolean | null,
    avgRoadWidth: [0, 50] as [number, number],
    trafficSignsDensity: [0, 1] as [number, number],
    potholes: null as boolean | null,
    cracks: null as boolean | null,
    policeCar: null as boolean | null,
    cones: null as boolean | null,
    accident: null as boolean | null,
    
    // Pedestrian Behavior
    riskyCrossing: null as boolean | null,
    runRedLight: null as boolean | null,
    crosswalkUse: null as boolean | null,
    nearbyPedestrians: [0, 20] as [number, number],
    crossingSpeed: [0, 5] as [number, number],
    timeToStart: [0, 30] as [number, number],
    
    // Demographics
    gender: [] as string[],
    ageRange: [0, 100] as [number, number],
    literacyRate: [0, 100] as [number, number],
    avgHeight: [140, 200] as [number, number],
    
    // Clothing & Accessories
    phoneUse: null as boolean | null,
    backpack: null as boolean | null,
    umbrella: null as boolean | null,
    handbag: null as boolean | null,
    suitcase: null as boolean | null,
    shirtType: [] as string[],
    bottomWear: [] as string[],
    dressType: [] as string[],
    
    // Vehicles
    vehiclePresence: null as boolean | null,
    car: [0, 1000] as [number, number],
    bus: [0, 100] as [number, number],
    truck: [0, 100] as [number, number],
    motorbike: [0, 200] as [number, number],
    bicycle: [0, 300] as [number, number],
  })

  // Get unique cities from the data
  const uniqueCities = Array.from(new Set(cityData.map(city => city.city))).sort()

  const handleCitySelect = (cityName: string) => {
    const newSelectedCity = cityName === "all" ? null : cityName
    setSelectedCity(newSelectedCity)
    setCitySearchOpen(false)
  }

  const updateFilter = (key: string, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const toggleArrayFilter = (key: string, value: string) => {
    setFilters(prev => {
      const current = prev[key as keyof typeof prev] as string[]
      const newArray = current.includes(value) 
        ? current.filter(item => item !== value)
        : [...current, value]
      return { ...prev, [key]: newArray }
    })
  }

  const resetFilters = () => {
    setFilters({
      continents: [],
      countries: [],
      population: [0, 50000000],
      trafficMortality: [0, 20],
      medianAge: [0, 80],
      giniIndex: [0, 100],
      weather: [],
      daytime: null,
      crosswalkPresent: null,
      sidewalkPresent: null,
      avgRoadWidth: [0, 50],
      trafficSignsDensity: [0, 1],
      potholes: null,
      cracks: null,
      policeCar: null,
      cones: null,
      accident: null,
      riskyCrossing: null,
      runRedLight: null,
      crosswalkUse: null,
      nearbyPedestrians: [0, 20],
      crossingSpeed: [0, 5],
      timeToStart: [0, 30],
      gender: [],
      ageRange: [0, 100],
      literacyRate: [0, 100],
      avgHeight: [140, 200],
      phoneUse: null,
      backpack: null,
      umbrella: null,
      handbag: null,
      suitcase: null,
      shirtType: [],
      bottomWear: [],
      dressType: [],
      vehiclePresence: null,
      car: [0, 1000],
      bus: [0, 100],
      truck: [0, 100],
      motorbike: [0, 200],
      bicycle: [0, 300],
    })
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
                  Search cities...
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

              {/* Filter Accordion */}
              <Accordion type="multiple" className="w-full space-y-2">
                
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
                        <div className="flex items-center space-x-1">
                          <Switch
                            id="crosswalk-use"
                            checked={filters.crosswalkUse === true}
                            onCheckedChange={(checked) => updateFilter('crosswalkUse', checked ? true : null)}
                          />
                          <label htmlFor="crosswalk-use">Crosswalk Use</label>
                        </div>
                      </div>
                      
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
                <AccordionItem value="vehicles">
                  <AccordionTrigger className="text-sm flex items-center gap-2">
                    <Car className="w-4 h-4" />
                    Vehicles
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="vehicle-presence"
                          checked={filters.vehiclePresence === true}
                          onCheckedChange={(checked) => updateFilter('vehiclePresence', checked ? true : null)}
                        />
                        <label htmlFor="vehicle-presence" className="text-xs">Vehicle Presence</label>
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Car Count</label>
                        <div className="px-2">
                          <Slider
                            value={filters.car}
                            onValueChange={(value) => updateFilter('car', value)}
                            min={0}
                            max={1000}
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
                </AccordionItem>
              </Accordion>

              {/* Action Buttons */}
              <div className="space-y-2 pt-4">
                <Button 
                  onClick={applyFilters}
                  disabled={loading}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {loading ? "Loading..." : "Apply Filters"}
                </Button>
                
                <Button 
                  onClick={resetFilters}
                  variant="outline"
                  className="w-full"
                >
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