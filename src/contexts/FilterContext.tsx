"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { CityInsight, MetricInsight } from '@/types/database'

interface FilterState {
  selectedCity: string | null
  selectedMetrics: string[]
  cityData: CityInsight[]
  metricData: MetricInsight[]
  filteredCityData: CityInsight | null
  filteredMetricData: MetricInsight | null
  loading: boolean
}

interface FilterContextType extends FilterState {
  setSelectedCity: (city: string | null) => void
  setSelectedMetrics: (metrics: string[]) => void
  applyFilters: () => void
  refreshData: () => void
}

const FilterContext = createContext<FilterContextType | undefined>(undefined)

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([])
  const [cityData, setCityData] = useState<CityInsight[]>([])
  const [metricData, setMetricData] = useState<MetricInsight[]>([])
  const [filteredCityData, setFilteredCityData] = useState<CityInsight | null>(null)
  const [filteredMetricData, setFilteredMetricData] = useState<MetricInsight | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshData = async () => {
    setLoading(true)
    try {
      // Fetch cities data
      const citiesResponse = await fetch('/api/cities')
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
  }

  const applyFilters = () => {
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
  }

  useEffect(() => {
    refreshData()
  }, [])

  const value: FilterContextType = {
    selectedCity,
    selectedMetrics,
    cityData,
    metricData,
    filteredCityData,
    filteredMetricData,
    loading,
    setSelectedCity,
    setSelectedMetrics,
    applyFilters,
    refreshData,
  }

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilter() {
  const context = useContext(FilterContext)
  if (context === undefined) {
    throw new Error('useFilter must be used within a FilterProvider')
  }
  return context
}
