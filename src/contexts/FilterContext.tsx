"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { CityGlobeData, CityVideo, MetricInsight } from '@/types/database'

export interface GranularFilters {
  // City Context
  continents: string[]
  countries: string[]
  population: [number, number]
  trafficMortality: [number, number]
  medianAge: [number, number]
  giniIndex: [number, number]
  
  // Environmental Context
  weather: string[]
  daytime: boolean | null
  crosswalkPresent: boolean | null
  sidewalkPresent: boolean | null
  avgRoadWidth: [number, number]
  trafficSignsDensity: [number, number]
  potholes: boolean | null
  cracks: boolean | null
  policeCar: boolean | null
  cones: boolean | null
  accident: boolean | null
  
  // Pedestrian Behavior
  riskyCrossing: boolean | null
  runRedLight: boolean | null
  crosswalkUse: boolean | null
  nearbyPedestrians: [number, number]
  crossingSpeed: [number, number]
  timeToStart: [number, number]
  
  // Demographics
  gender: string[]
  ageRange: [number, number]
  literacyRate: [number, number]
  avgHeight: [number, number]
  
  // Clothing & Accessories
  phoneUse: boolean | null
  backpack: boolean | null
  umbrella: boolean | null
  handbag: boolean | null
  suitcase: boolean | null
  shirtType: string[]
  bottomWear: string[]
  dressType: string[]
  
  // Vehicles
  vehiclePresence: boolean | null
  car: [number, number]
  bus: [number, number]
  truck: [number, number]
  motorbike: [number, number]
  bicycle: [number, number]
}

interface FilterState {
  selectedCity: string | null
  selectedMetrics: string[]
  granularFilters: GranularFilters
  cityData: CityGlobeData[]
  metricData: MetricInsight[]
  filteredCityData: CityGlobeData | null
  filteredMetricData: MetricInsight | null
  // Videos of the selected city — fetched ONCE here and shared by the Globe (markers)
  // and InfoSidebar (list), which previously each issued their own request.
  cityVideos: CityVideo[]
  loading: boolean
}

interface FilterContextType extends FilterState {
  setSelectedCity: (city: string | null) => void
  setSelectedMetrics: (metrics: string[]) => void
  setGranularFilters: (filters: GranularFilters) => void
  updateGranularFilter: <K extends keyof GranularFilters>(key: K, value: GranularFilters[K]) => void
  resetGranularFilters: () => void
  applyFilters: () => void
  refreshData: () => void
}

const FilterContext = createContext<FilterContextType | undefined>(undefined)

const DEFAULT_GRANULAR_FILTERS: GranularFilters = {
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
  car: [0, 500],
  bus: [0, 100],
  truck: [0, 100],
  motorbike: [0, 200],
  bicycle: [0, 300],
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([])
  const [granularFilters, setGranularFilters] = useState<GranularFilters>(DEFAULT_GRANULAR_FILTERS)
  const [cityData, setCityData] = useState<CityGlobeData[]>([])
  const [metricData, setMetricData] = useState<MetricInsight[]>([])
  const [filteredCityData, setFilteredCityData] = useState<CityGlobeData | null>(null)
  const [filteredMetricData, setFilteredMetricData] = useState<MetricInsight | null>(null)
  const [cityVideos, setCityVideos] = useState<CityVideo[]>([])
  const [loading, setLoading] = useState(false)
  const cityVideosAbortRef = useRef<AbortController | null>(null)

  // One shared, abortable fetch of the selected city's videos. Selecting a new city
  // aborts the in-flight request for the old one, so a slow response can never
  // overwrite the newer city's videos.
  useEffect(() => {
    cityVideosAbortRef.current?.abort()
    // Clear immediately on EVERY change so the previous city's videos never linger in
    // the sidebar/globe while the new city's fetch is in flight.
    setCityVideos([])
    if (!selectedCity) {
      return
    }
    const ctrl = new AbortController()
    cityVideosAbortRef.current = ctrl
    ;(async () => {
      try {
        const response = await fetch(
          `/api/cities/${encodeURIComponent(selectedCity)}/videos?limit=100`,
          { signal: ctrl.signal }
        )
        const result = await response.json()
        if (!ctrl.signal.aborted) {
          setCityVideos(result.success ? result.data : [])
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          console.error('Error fetching city videos:', error)
          setCityVideos([])
        }
      }
    })()
    return () => ctrl.abort()
  }, [selectedCity])

  // Stable callbacks so the memoized context value below only changes when actual
  // state changes — otherwise every provider render re-rendered every consumer
  // (FilterSidebar, InfoSidebar, Globe, MainContent) on each slider tick.
  const refreshData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch cities data - request all cities (no limit or high limit)
      const citiesResponse = await fetch('/api/cities?limit=10000')
      const citiesResult = await citiesResponse.json()
      if (citiesResult.success) {
        setCityData(citiesResult.data)
      }

      // Fetch metrics data
      const metricsResponse = await fetch('/api/insights/metrics')
      const metricsResult = await metricsResponse.json()
      if (metricsResult.success) {
        setMetricData(metricsResult.data)
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const updateGranularFilter = useCallback(<K extends keyof GranularFilters>(key: K, value: GranularFilters[K]) => {
    setGranularFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  const resetGranularFilters = useCallback(() => {
    setGranularFilters(DEFAULT_GRANULAR_FILTERS)
  }, [])

  const applyFilters = useCallback(() => {
    // Filter city data
    if (selectedCity) {
      const city = cityData.find(c => c.city === selectedCity)
      setFilteredCityData(city || null)
    } else {
      setFilteredCityData(null)
    }

    // Filter metric data - show the first selected metric if any
    if (selectedMetrics.length > 0) {
      const metric = metricData.find(m => m.metric_type === selectedMetrics[0])
      setFilteredMetricData(metric || null)
    } else {
      setFilteredMetricData(null)
    }
  }, [selectedCity, selectedMetrics, cityData, metricData])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  // Automatically apply filters when selectedCity or selectedMetrics change
  useEffect(() => {
    applyFilters()
  }, [applyFilters])

  const value: FilterContextType = useMemo(() => ({
    selectedCity,
    selectedMetrics,
    granularFilters,
    cityData,
    metricData,
    filteredCityData,
    filteredMetricData,
    cityVideos,
    loading,
    setSelectedCity,
    setSelectedMetrics,
    setGranularFilters,
    updateGranularFilter,
    resetGranularFilters,
    applyFilters,
    refreshData,
  }), [
    selectedCity,
    selectedMetrics,
    granularFilters,
    cityData,
    metricData,
    filteredCityData,
    filteredMetricData,
    cityVideos,
    loading,
    updateGranularFilter,
    resetGranularFilters,
    applyFilters,
    refreshData,
  ])

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilter() {
  const context = useContext(FilterContext)
  if (context === undefined) {
    throw new Error('useFilter must be used within a FilterProvider')
  }
  return context
}
