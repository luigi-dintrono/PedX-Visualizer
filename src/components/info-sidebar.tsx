"use client"

import { filterParams } from '@/lib/filter-params'
import { displayValue, comparableValue, METRICS } from '@/lib/metrics'

import {
  BarChart3,
  TrendingUp,
  Clock,
  Users,
  Activity,
  Filter,
  Globe,
  Cloud,
  User,
  Car,
  ChevronRight,
  ExternalLink,
  Eye,
  AlertTriangle,
  Zap,
  Shield,
  Car as CarIcon,
  Gauge,
  LineChart
} from "lucide-react"
import { useState, useEffect, useRef, useMemo } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ListItem } from "@/components/ui/list-item"
import { Button } from "@/components/ui/button"
import { useFilter } from "@/contexts/FilterContext"
import { CityInsight, MeasuredBehavior } from "@/types/database"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

// The measured-behaviour card is worth showing only when at least one module actually
// produced something. pipeline/pedestrian_counts are always populated (they are derived
// from the videos rows themselves), so they do not count as content on their own.
function hasMeasuredBehavior(mb: MeasuredBehavior): boolean {
  return Boolean(
    mb.crossing_speed ||
    mb.vehicle_speed ||
    mb.flow ||
    mb.conflicts ||
    mb.signal ||
    mb.micro_events ||
    mb.social ||
    mb.pose ||
    mb.pedestrian_kinematics
  )
}

interface TopInsight {
  city: string;
  country: string;
  continent: string;
  city_id: number;
  insight_text: string;
  insight_category: string;
  relevance_score: number;
  data_confidence: string;
}

interface MetricData {
  metric: {
    key: string;
    name: string;
    unit: string;
    description: string;
  };
  global: {
    value: number | null;
    totalCities: number;
    totalVideos: number;
    totalPedestrians: number;
  };
  cities: Array<{
    id: number;
    sampleSize?: number | null;
    rank: number;
    city: string;
    country: string;
    continent: string;
    value: number;
    videoCount: number;
    pedestrianCount: number;
    deltaVsGlobal: number | null;
    rankValue: number | null;
    // Model-based interval (scripts/estimate_city_rates.py) for the four per-pedestrian
    // rates; null for other metrics. Same unit/scale as `value`.
    estimate: {
      mean: number;
      low: number;
      high: number;
      videos: number | null;
      rankLow: number | null;
      rankHigh: number | null;
      rankedCities: number | null;
    } | null;
  }>;
}

interface MetricRelationship {
  factor: string;
  category: string;
  value: string;
  effect: string;
  effectSize: number;
  description: string;
}

interface TemporalMetricData {
  metric: {
    key: string;
    name: string;
    unit: string;
  };
  chartData: Array<{
    date: string;
    value: number;
    fullDate: string;
  }>;
  timelineBasis?: 'analysis' | 'recorded';
  notice?: string;
  dateRange: {
    start: string;
    end: string;
    months: number;
  };
}

export function InfoSidebar() {
  // cityVideos comes from the context's single shared fetch (also used by the Globe's markers)
  const { filteredCityData, selectedCity, setSelectedCity, cityVideos, selectedMetrics, granularFilters, loading: cohortLoading, error: cohortError } = useFilter()
  const cohortQuery = useMemo(() => filterParams(granularFilters, selectedMetrics[0]).toString(), [granularFilters, selectedMetrics])
  const metricAbortRef = useRef<AbortController | null>(null)
  const relationshipAbortRef = useRef<AbortController | null>(null)
  const baselineAbortRef = useRef<AbortController | null>(null)
  const topAbortRef = useRef<AbortController | null>(null)
  const temporalAbortRef = useRef<AbortController | null>(null)
  const [metricError, setMetricError] = useState<string | null>(null)
  const [topInsights, setTopInsights] = useState<TopInsight[]>([])
  const [metricData, setMetricData] = useState<MetricData | null>(null)
  const [metricRelationships, setMetricRelationships] = useState<MetricRelationship[]>([])
  const [relationshipNotice, setRelationshipNotice] = useState('Statistical evidence is loading.')
  const [loading, setLoading] = useState(false)
  const [metricLoading, setMetricLoading] = useState(false)
  const [temporalData, setTemporalData] = useState<TemporalMetricData | null>(null)
  const [selectedMetricForChart, setSelectedMetricForChart] = useState<string | null>(null)
  const [temporalLoading, setTemporalLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [globalInsights, setGlobalInsights] = useState<{
    crossing_speed: number | null;
    // MEASURED walking speed (dense video tracking) — null until any video has
    // been through the dense-tracking pass; never coerced to 0.
    measured_walking_speed: number | null;
    videos_with_measured_speed?: number;
    crossing_time: number | null;
    risky_crossing_rate: number | null;
    run_red_light_rate: number | null;
    crosswalk_usage_rate: number | null;
    phone_usage_rate: number | null;
    avg_pedestrian_age: number | null;
  } | null>(null)
  const [cityDetails, setCityDetails] = useState<{
    rankings: {
      crossing_speed: { rank: number | null; total_cities: number | null };
      risky_crossing: { rank: number | null; total_cities: number | null };
      run_red_light: { rank: number | null; total_cities: number | null };
      // Sparse MEASURED metric: rank only among cities with dense-tracked videos
      measured_walking_speed: { rank: number | null; total_cities: number | null };
    };
    environment: {
      weather: Array<{ type: string; percentage: number }>;
      daytime: Array<{ type: string; percentage: number }>;
    };
    demographics: {
      gender: Array<{ type: string; percentage: number }>;
      age: Array<{ group: string; risky_rate: number | null; risky_n: number; red_light_rate: number | null }>;
    };
    vehicles: Array<{ type: string; percentage: number }>;
    risk_factors: Array<{ factor: string; risk_increase: number; sample_size: number }>;
    avg_pedestrian_age: number | null;
    // Per-city insight texts, served here since the bulk /api/cities list no longer carries them
    insights?: CityInsight[] | null;
    // PedX-Insight measured behaviour. Every group is null when the module that produces it
    // never ran for this city, which the UI renders as absent rather than as zero.
    measured_behavior?: MeasuredBehavior | null;
  } | null>(null)
  const [cityDetailsLoading, setCityDetailsLoading] = useState(false)
  const cityDetailsAbortRef = useRef<AbortController | null>(null)

  // Per-city insight texts: served by the details fetch (the bulk /api/cities list no
  // longer carries the heavy insights JSONB); filteredCityData is the legacy fallback.
  const cityInsights = cityDetails?.insights ?? null

  // Fetch global insights once on mount
  useEffect(() => {
    fetchGlobalInsights()
  }, [cohortQuery])

  // Fetch top insights for Empty mode
  useEffect(() => {
    temporalAbortRef.current?.abort()
    setTemporalData(null)
    setDrawerOpen(false)
    if (!selectedCity && selectedMetrics.length === 0) {
      fetchTopInsights()
      setMetricData(null)
      setMetricRelationships([])
    } else if (!selectedCity && selectedMetrics.length > 0) {
      // Fetch metric data
      fetchMetricData(selectedMetrics[0])
      fetchMetricRelationships(selectedMetrics[0])
    } else if (selectedCity) {
      // (city videos arrive via FilterContext.cityVideos — one shared fetch)
      fetchCityDetails(selectedCity)
      setMetricData(null)
      setMetricRelationships([])
    }
  }, [selectedCity, selectedMetrics, cohortQuery])

  const fetchGlobalInsights = async () => {
    baselineAbortRef.current?.abort()
    const controller = new AbortController()
    baselineAbortRef.current = controller
    setGlobalInsights(null)
    try {
      const response = await fetch(`/api/insights/global?${cohortQuery}`, { signal: controller.signal })
      const result = await response.json()
      if (result.success) {
        if (!controller.signal.aborted) setGlobalInsights(result.data)
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error('Error fetching global insights:', error)
    }
  }

  const fetchTopInsights = async () => {
    topAbortRef.current?.abort()
    const controller = new AbortController()
    topAbortRef.current = controller
    setTopInsights([])
    setLoading(true)
    try {
      const response = await fetch(`/api/insights/top?limit=5&${cohortQuery}`, { signal: controller.signal })
      const result = await response.json()
      if (result.success) {
        if (!controller.signal.aborted) setTopInsights(result.data)
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error('Error fetching top insights:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCityDetails = async (city: string) => {
    // Abort a superseded in-flight request and clear the PREVIOUS city's details right
    // away — otherwise switching cities briefly showed the old city's rankings/insights,
    // and a slow old response could land after (and overwrite) the new city's data.
    cityDetailsAbortRef.current?.abort()
    const ctrl = new AbortController()
    cityDetailsAbortRef.current = ctrl
    setCityDetails(null)
    setCityDetailsLoading(true)
    try {
      const response = await fetch(`/api/cities/${encodeURIComponent(city)}/details?${cohortQuery}`, { signal: ctrl.signal })
      const result = await response.json()
      if (ctrl.signal.aborted) return
      if (result.success && result.data) {
        setCityDetails(result.data)
      } else {
        console.warn('City details API returned unsuccessful or no data:', result)
        setCityDetails(null)
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return
      console.error('Error fetching city details:', error)
      setCityDetails(null)
    } finally {
      if (!ctrl.signal.aborted) setCityDetailsLoading(false)
    }
  }

  const fetchMetricData = async (metric: string) => {
    metricAbortRef.current?.abort()
    const controller = new AbortController()
    metricAbortRef.current = controller
    setMetricData(null)
    setMetricError(null)
    setMetricLoading(true)
    try {
      const response = await fetch(`/api/metrics/${metric}?${cohortQuery}`, { signal: controller.signal })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Metric evidence unavailable')
      if (result.success) {
        if (!controller.signal.aborted) setMetricData(result.data)
      }
    } catch (error) {
      if (!controller.signal.aborted) { console.error('Error fetching metric data:', error); setMetricData(null); setMetricError('Metric evidence could not be loaded. Check the dataset release and retry.') }
    } finally {
      if (!controller.signal.aborted) setMetricLoading(false)
    }
  }

  const fetchMetricRelationships = async (metric: string) => {
    relationshipAbortRef.current?.abort()
    const controller = new AbortController()
    relationshipAbortRef.current = controller
    setMetricRelationships([])
    try {
      const response = await fetch(`/api/metrics/${metric}/relationships?${cohortQuery}`, { signal: controller.signal })
      const result = await response.json()
      if (result.success) {
        if (!controller.signal.aborted) { setMetricRelationships(result.data.relationships); setRelationshipNotice(result.data.notice || '') }
      }
    } catch (error) {
      if (!controller.signal.aborted) { console.error('Error fetching metric relationships:', error); setMetricRelationships([]) }
    }
  }

  const fetchTemporalData = async (metric: string, city: string) => {
    temporalAbortRef.current?.abort()
    const controller = new AbortController()
    temporalAbortRef.current = controller
    setTemporalData(null)
    setTemporalLoading(true)
    try {
      // Map metric display names to API keys
      const metricMap: { [key: string]: string } = {
        'Crossing Speed': 'crossing-speed',
        'Measured Walking Speed': 'measured-walking-speed',
        'Reference Crossing Time': 'crossing-time',
        'Risky Crossing': 'risky-crossing',
        'Red Light Rate': 'red-light',
        'Crosswalk Usage': 'crosswalk-usage'
      }

      const metricKey = metricMap[metric] || metric.toLowerCase().replace(/\s+/g, '-')
      const response = await fetch(
        `/api/cities/${encodeURIComponent(city)}/metrics/${metricKey}/temporal?months=6&${cohortQuery}`, { signal: controller.signal }
      )
      const result = await response.json()
      if (result.success) {
        if (!controller.signal.aborted) setTemporalData(result.data)
      } else {
        setTemporalData(null)
      }
    } catch (error) {
      if (!controller.signal.aborted) { console.error('Error fetching temporal data:', error); setTemporalData(null) }
    } finally {
      if (!controller.signal.aborted) setTemporalLoading(false)
    }
  }

  const handleMetricCardClick = (metricName: string) => {
    if (!selectedCity) return
    setSelectedMetricForChart(metricName)
    setDrawerOpen(true)
    fetchTemporalData(metricName, selectedCity)
  }

  const rateValue = (metric: string) => comparableValue(filteredCityData as unknown as Record<string, unknown> | null, metric)
  const rateDisplay = (metric: string) => {
    const value = rateValue(metric)
    return value == null ? 'Insufficient evidence' : `${displayValue(value, '%')}%`
  }
  const rateEvidence = (metric: string, denominator: string) => {
    if (!filteredCityData) return 'No observations'
    const row = filteredCityData as unknown as Record<string, unknown>
    const n = Number(row[denominator] || 0)
    if (n < METRICS[metric].minN) return `n=${n} known observations; at least ${METRICS[metric].minN} are required to display this rate`
    if (row[`${metric}_lo`] != null && row[`${metric}_hi`] != null) {
      return `n=${n} known observations; 95% model interval for a new video ${displayValue(row[`${metric}_lo`], '%')}–${displayValue(row[`${metric}_hi`], '%')}%`
    }
    return `n=${n} known observations; confidence interval unavailable for this cohort and release`
  }

  const formatNumber = (value: string | number | null | undefined, decimals: number = 2): string => {
    if (value === null || value === undefined) return 'N/A'
    const num = typeof value === 'string' ? Number(value) : value
    return isNaN(num) ? 'N/A' : num.toFixed(decimals)
  }

  // Calculate percentage difference vs global for a metric
  const calculateDeltaVsGlobal = (
    cityValue: string | number | null | undefined,
    globalValue: number | null | undefined,
    metricType: 'rate' | 'speed' | 'time' = 'rate'
  ): { delta: number | null; formatted: string; color: string } => {
    // Only bail when values are genuinely missing/non-numeric, or when the global
    // baseline is 0 (division undefined). A valid city value of 0 must NOT be dropped
    // by a truthiness check.
    const cityNum = typeof cityValue === 'string' ? parseFloat(cityValue) : cityValue
    if (cityNum == null || isNaN(cityNum) || globalValue == null || globalValue === 0) {
      return { delta: null, formatted: 'N/A', color: 'text-muted-foreground' }
    }

    // Normalize values: if city value is < 1 and metricType is rate, it's a ratio (0-1), convert to percentage
    let cityNormalized = cityNum
    const globalNormalized = globalValue

    if (metricType === 'rate') {
      // If city value is less than 1, it's likely a ratio, convert to percentage
      if (Number.isFinite(cityNum)) {
        cityNormalized = cityNum * 100
      }
      // Global value is already in percentage form (from API conversion)
    }

    // Calculate percentage difference
    const delta = ((cityNormalized - globalNormalized) / globalNormalized) * 100

    const formatted = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`

    // Color will be determined by the calling function based on metric semantics
    const color = 'text-muted-foreground' // Default, will be overridden

    return { delta, formatted, color }
  }

  // Helper to get delta for specific metrics with proper color coding
  const getMetricDelta = (metricKey: string, cityValue: string | number | null | undefined): { formatted: string; color: string } => {
    if (!globalInsights) {
      return { formatted: 'N/A', color: 'text-muted-foreground' }
    }

    let globalValue: number | null = null
    let metricType: 'rate' | 'speed' | 'time' = 'rate'

    switch (metricKey) {
      case 'crossing_speed':
        globalValue = globalInsights.crossing_speed
        metricType = 'speed'
        break
      case 'measured_walking_speed':
        globalValue = globalInsights.measured_walking_speed
        metricType = 'speed'
        break
      case 'crossing_time':
        globalValue = globalInsights.crossing_time
        metricType = 'time'
        break
      case 'risky_crossing_rate':
        globalValue = globalInsights.risky_crossing_rate
        metricType = 'rate'
        break
      case 'run_red_light_rate':
        globalValue = globalInsights.run_red_light_rate
        metricType = 'rate'
        break
      case 'crosswalk_usage_rate':
        globalValue = globalInsights.crosswalk_usage_rate
        metricType = 'rate'
        break
      default:
        return { formatted: 'N/A', color: 'text-muted-foreground' }
    }

    const result = calculateDeltaVsGlobal(cityValue, globalValue, metricType)

    // Override color based on metric semantics
    if (metricKey === 'risky_crossing_rate' || metricKey === 'run_red_light_rate') {
      // Lower is better - green for negative delta, red for positive
      return {
        formatted: result.formatted,
        color: result.delta !== null && result.delta < 0 ? 'text-green-600' : 'text-red-600'
      }
    } else if (metricKey === 'crosswalk_usage_rate') {
      // Higher is better - green for positive delta, red for negative
      return {
        formatted: result.formatted,
        color: result.delta !== null && result.delta > 0 ? 'text-green-600' : 'text-red-600'
      }
    } else if (metricKey === 'crossing_speed' || metricKey === 'measured_walking_speed') {
      // Higher speed might be better (more efficient) - green for positive, red for negative
      return {
        formatted: result.formatted,
        color: result.delta !== null && result.delta > 0 ? 'text-green-600' : 'text-red-600'
      }
    } else if (metricKey === 'crossing_time') {
      // Lower time is better - green for negative delta, red for positive
      return {
        formatted: result.formatted,
        color: result.delta !== null && result.delta < 0 ? 'text-green-600' : 'text-red-600'
      }
    }

    return { formatted: result.formatted, color: result.color }
  }

  const getCountryEmoji = (country: string): string => {
    // Comprehensive country to emoji mapping
    const countryEmojis: { [key: string]: string } = {
      // Countries in your database
      'Monaco': '🇲🇨',
      'Australia': '🇦🇺',
      'United States': '🇺🇸',
      'Italy': '🇮🇹',
      'Japan': '🇯🇵',
      'Venezuela': '🇻🇪',
      'South Africa': '🇿🇦',
      'Germany': '🇩🇪',
      'Romania': '🇷🇴',

      // Common variations and aliases
      'USA': '🇺🇸',
      'US': '🇺🇸',
      'United States of America': '🇺🇸',
      'UK': '🇬🇧',
      'United Kingdom': '🇬🇧',
      'Great Britain': '🇬🇧',

      // Major countries for future expansion
      'France': '🇫🇷',
      'Spain': '🇪🇸',
      'China': '🇨🇳',
      'India': '🇮🇳',
      'Brazil': '🇧🇷',
      'Canada': '🇨🇦',
      'Mexico': '🇲🇽',
      'Russia': '🇷🇺',
      'Egypt': '🇪🇬',
      'Nigeria': '🇳🇬',
      'Kenya': '🇰🇪',
      'Argentina': '🇦🇷',
      'Chile': '🇨🇱',
      'Colombia': '🇨🇴',
      'Peru': '🇵🇪',
      'Poland': '🇵🇱',
      'Netherlands': '🇳🇱',
      'Belgium': '🇧🇪',
      'Switzerland': '🇨🇭',
      'Austria': '🇦🇹',
      'Sweden': '🇸🇪',
      'Norway': '🇳🇴',
      'Denmark': '🇩🇰',
      'Finland': '🇫🇮',
      'Ireland': '🇮🇪',
      'Portugal': '🇵🇹',
      'Greece': '🇬🇷',
      'Turkey': '🇹🇷',
      'Israel': '🇮🇱',
      'Saudi Arabia': '🇸🇦',
      'United Arab Emirates': '🇦🇪',
      'Thailand': '🇹🇭',
      'Vietnam': '🇻🇳',
      'Indonesia': '🇮🇩',
      'Malaysia': '🇲🇾',
      'Singapore': '🇸🇬',
      'Philippines': '🇵🇭',
      'South Korea': '🇰🇷',
      'Taiwan': '🇹🇼',
      'Hong Kong': '🇭🇰',
      'New Zealand': '🇳🇿',
      'North Korea': '🇰🇵',
      'Pakistan': '🇵🇰',
      'Bangladesh': '🇧🇩',
      'Sri Lanka': '🇱🇰',
      'Nepal': '🇳🇵',
      'Myanmar': '🇲🇲',
      'Cambodia': '🇰🇭',
      'Laos': '🇱🇦',
      'Mongolia': '🇲🇳',
      'Kazakhstan': '🇰🇿',
      'Uzbekistan': '🇺🇿',
      'Kyrgyzstan': '🇰🇬',
      'Tajikistan': '🇹🇯',
      'Turkmenistan': '🇹🇲',
      'Afghanistan': '🇦🇫',
      'Iran': '🇮🇷',
      'Iraq': '🇮🇶',
      'Syria': '🇸🇾',
      'Lebanon': '🇱🇧',
      'Jordan': '🇯🇴',
      'Palestine': '🇵🇸',
      'Kuwait': '🇰🇼',
      'Qatar': '🇶🇦',
      'Bahrain': '🇧🇭',
      'Oman': '🇴🇲',
      'Yemen': '🇾🇪',
      'Iceland': '🇮🇸',
      'Luxembourg': '🇱🇺',
      'Malta': '🇲🇹',
      'Cyprus': '🇨🇾',
      'Croatia': '🇭🇷',
      'Serbia': '🇷🇸',
      'Bosnia and Herzegovina': '🇧🇦',
      'Montenegro': '🇲🇪',
      'Albania': '🇦🇱',
      'North Macedonia': '🇲🇰',
      'Bulgaria': '🇧🇬',
      'Moldova': '🇲🇩',
      'Ukraine': '🇺🇦',
      'Belarus': '🇧🇾',
      'Lithuania': '🇱🇹',
      'Latvia': '🇱🇻',
      'Estonia': '🇪🇪',
      'Slovenia': '🇸🇮',
      'Slovakia': '🇸🇰',
      'Czech Republic': '🇨🇿',
      'Hungary': '🇭🇺',
      'Cuba': '🇨🇺',
      'Jamaica': '🇯🇲',
      'Haiti': '🇭🇹',
      'Dominican Republic': '🇩🇴',
      'Puerto Rico': '🇵🇷',
      'Costa Rica': '🇨🇷',
      'Panama': '🇵🇦',
      'Guatemala': '🇬🇹',
      'Honduras': '🇭🇳',
      'El Salvador': '🇸🇻',
      'Nicaragua': '🇳🇮',
      'Belize': '🇧🇿',
      'Ecuador': '🇪🇨',
      'Bolivia': '🇧🇴',
      'Paraguay': '🇵🇾',
      'Uruguay': '🇺🇾',
      'Guyana': '🇬🇾',
      'Suriname': '🇸🇷',
      'French Guiana': '🇬🇫',
      'Algeria': '🇩🇿',
      'Morocco': '🇲🇦',
      'Tunisia': '🇹🇳',
      'Libya': '🇱🇾',
      'Sudan': '🇸🇩',
      'Ethiopia': '🇪🇹',
      'Tanzania': '🇹🇿',
      'Uganda': '🇺🇬',
      'Ghana': '🇬🇭',
      'Ivory Coast': '🇨🇮',
      'Senegal': '🇸🇳',
      'Mali': '🇲🇱',
      'Burkina Faso': '🇧🇫',
      'Niger': '🇳🇪',
      'Chad': '🇹🇩',
      'Cameroon': '🇨🇲',
      'Central African Republic': '🇨🇫',
      'Democratic Republic of the Congo': '🇨🇩',
      'Republic of the Congo': '🇨🇬',
      'Gabon': '🇬🇦',
      'Equatorial Guinea': '🇬🇶',
      'São Tomé and Príncipe': '🇸🇹',
      'Angola': '🇦🇴',
      'Zambia': '🇿🇲',
      'Zimbabwe': '🇿🇼',
      'Botswana': '🇧🇼',
      'Namibia': '🇳🇦',
      'Lesotho': '🇱🇸',
      'Swaziland': '🇸🇿',
      'Madagascar': '🇲🇬',
      'Mauritius': '🇲🇺',
      'Seychelles': '🇸🇨',
      'Comoros': '🇰🇲',
      'Djibouti': '🇩🇯',
      'Somalia': '🇸🇴',
      'Eritrea': '🇪🇷',
      'Rwanda': '🇷🇼',
      'Burundi': '🇧🇮',
      'Malawi': '🇲🇼',
      'Mozambique': '🇲🇿'
    }

    // Try exact match first
    if (countryEmojis[country]) {
      return countryEmojis[country]
    }

    // Try case-insensitive match
    const lowerName = country.toLowerCase().trim()
    for (const [key, emoji] of Object.entries(countryEmojis)) {
      if (key.toLowerCase() === lowerName) {
        return emoji
      }
    }

    // Handle special cases
    if (country === 'Unknown' || !country || country.trim() === '') {
      return '❓' // Question mark for unknown countries
    }

    return '🌍' // Default fallback
  }


  const handleInsightClick = (city: string) => {
    setSelectedCity(city)
    // The useEffect in FilterContext will automatically apply filters
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'speed': return <Gauge className="w-4 h-4" />
      case 'behavior': return <Users className="w-4 h-4" />
      case 'demographic': return <User className="w-4 h-4" />
      case 'weather': return <Cloud className="w-4 h-4" />
      case 'vehicle': return <Car className="w-4 h-4" />
      case 'rank': return <TrendingUp className="w-4 h-4" />
      default: return <BarChart3 className="w-4 h-4" />
    }
  }

  // Metric Mode (metric selected, no city selected)
  if (!selectedCity && selectedMetrics.length > 0) {
    if (metricLoading || !metricData) {
      return (
        <div className="h-full w-full border-l bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">{metricError || 'Loading metric data...'}</div>
            {metricError && <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchMetricData(selectedMetrics[0])}>Retry</Button>}
          </div>
        </div>
      )
    }

    // Get active filter badges for display
    const getActiveFilterChips = () => {
      const chips = []
      if (granularFilters.continents.length > 0) {
        chips.push(...granularFilters.continents.map(c => ({ label: c, type: 'continent' })))
      }
      if (granularFilters.weather.length > 0) {
        chips.push(...granularFilters.weather.map(w => ({ label: w, type: 'weather' })))
      }
      if (granularFilters.daytime !== null) {
        chips.push({ label: granularFilters.daytime ? 'Day' : 'Night', type: 'time' })
      }
      if (granularFilters.gender.length > 0) {
        chips.push(...granularFilters.gender.map(g => ({ label: g, type: 'gender' })))
      }
      return chips
    }

    const activeFilters = getActiveFilterChips()

    return (
      <div className="h-full w-full border-l bg-background">
        <div className="h-full overflow-y-auto">
          <div className="p-4 space-y-6">
            {/* Header */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-bold">{metricData.metric.name}</h2>
              </div>

              <p className="text-sm text-muted-foreground">
                {metricData.metric.description}
              </p>

              {/* Global Average Badge */}
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm font-mono">
                  Global: {metricData.global.value?.toFixed(2)} {metricData.metric.unit}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  across {metricData.global.totalCities} cities
                </span>
              </div>

              {/* Active Filters */}
              {activeFilters.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <span className="text-xs text-muted-foreground">Filters:</span>
                  {activeFilters.map((chip, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs capitalize">
                      {chip.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Top Cities */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Top Cities
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y max-h-[300px] overflow-y-auto">
                  {metricData.cities.slice(0, 10).map((city) => (
                    <ListItem
                      key={`${city.city}-${city.country}-${city.rank}`}
                      onClick={() => setSelectedCity(String(city.id))}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className="text-lg font-bold text-muted-foreground w-8">
                          #{city.rank}
                        </div>
                        <div className="text-xl">
                          {getCountryEmoji(city.country)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {city.city}, {city.country}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="font-mono font-bold text-foreground">
                              {city.value.toFixed(2)} {metricData.metric.unit}
                            </span>
                            {city.deltaVsGlobal !== null && (
                              <span className={city.deltaVsGlobal > 0 ? 'text-red-600' : 'text-green-600'}>
                                {city.deltaVsGlobal > 0 ? '↑' : '↓'} {Math.abs(city.deltaVsGlobal).toFixed(1)}% vs global
                              </span>
                            )}
                            <span>{city.videoCount} videos</span>
                          </div>
                          {city.estimate && (
                            // One video is one place, one time, one camera, so a single-video
                            // city's interval is wide on purpose; the rank interval says how
                            // far the position above can be trusted.
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Model {city.estimate.mean.toFixed(0)}{metricData.metric.unit} (95% interval {city.estimate.low.toFixed(0)}–{city.estimate.high.toFixed(0)})
                              {city.estimate.rankLow != null && city.estimate.rankHigh != null && city.estimate.rankedCities != null
                                ? ` · rank ${city.estimate.rankLow === city.estimate.rankHigh ? city.estimate.rankLow : `${city.estimate.rankLow}–${city.estimate.rankHigh}`} of ${city.estimate.rankedCities}`
                                : ''}
                            </div>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </ListItem>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Relationships */}
            {(metricRelationships.length > 0 || relationshipNotice) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Statistical Evidence
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {relationshipNotice && <p className="text-xs text-muted-foreground">{relationshipNotice}</p>}
                  {metricRelationships.slice(0, 6).map((rel, idx) => (
                    <div key={idx} className="p-3 bg-muted/50 rounded-md border border-border/50">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          {rel.category === 'Environmental' && <Cloud className="w-4 h-4" />}
                          {rel.category === 'Demographics' && <User className="w-4 h-4" />}
                          {rel.category === 'Vehicles' && <Car className="w-4 h-4" />}
                          <span className="text-xs font-medium">{rel.factor}</span>
                        </div>
                        <Badge
                          variant={rel.effectSize > 0 ? 'destructive' : 'default'}
                          className="text-xs"
                        >
                          {rel.effect}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{rel.description}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Top Insights */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Key Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="space-y-2 text-sm">
                  {metricData.cities.length > 0 && <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>
                      <strong>{metricData.cities[0]?.city || 'No eligible city'}</strong> appears first in this descriptive ordering at {metricData.cities[0]?.value.toFixed(2)} {metricData.metric.unit},
                      {metricData.cities[0]?.deltaVsGlobal && metricData.cities[0].deltaVsGlobal > 0 ? ' above' : ' below'} the global average
                      {metricData.cities[0]?.estimate
                        ? ` (95% interval ${metricData.cities[0].estimate.low.toFixed(0)}–${metricData.cities[0].estimate.high.toFixed(0)}${metricData.metric.unit}, from ${metricData.cities[0].estimate.videos ?? '?'} video${metricData.cities[0].estimate.videos === 1 ? '' : 's'}).`
                        : '.'}
                    </span>
                  </li>}
                  {metricData.cities.length === 0 && <li>No city meets this metric&apos;s evidence and sample requirements.</li>}
                  {metricRelationships.length > 0 && (
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1">•</span>
                      <span>{metricRelationships[0].description}</span>
                    </li>
                  )}
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>
                      Data collected from {metricData.global.totalVideos} videos across {metricData.global.totalCities} cities,
                      including {metricData.global.totalPedestrians.toLocaleString()} tracked pedestrian observations.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* All Cities Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  All Cities ({metricData.cities.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium">#</th>
                        <th className="text-left p-2 font-medium">City</th>
                        <th className="text-left p-2 font-medium">Country</th>
                        <th className="text-right p-2 font-medium">Value</th>
                        <th className="text-right p-2 font-medium">Δ Global</th>
                        <th className="text-right p-2 font-medium">Videos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {metricData.cities.map((city) => (
                        <tr
                          key={`${city.city}-${city.country}-${city.rank}`}
                          className="hover:bg-muted/50 cursor-pointer"
                          onClick={() => setSelectedCity(String(city.id))}
                        >
                          <td className="p-2 text-muted-foreground">#{city.rank}</td>
                          <td className="p-2 font-medium">{city.city}</td>
                          <td className="p-2 text-muted-foreground">{city.country}</td>
                          <td className="p-2 text-right font-mono">
                            {city.value.toFixed(2)} {metricData.metric.unit}
                          </td>
                          <td className={`p-2 text-right ${
                            city.deltaVsGlobal && city.deltaVsGlobal > 0 ? 'text-red-600' : 'text-green-600'
                          }`}>
                            {city.deltaVsGlobal !== null
                              ? `${city.deltaVsGlobal > 0 ? '+' : ''}${city.deltaVsGlobal.toFixed(1)}%`
                              : 'N/A'}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">{city.videoCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  if (selectedCity && !filteredCityData) {
    return <div className="h-full w-full border-l bg-background p-4">
      <Card><CardHeader><CardTitle className="text-base">{cohortLoading ? 'Loading this cohort' : 'No matching observations'}</CardTitle></CardHeader>
        <CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{cohortError || (cohortLoading ? 'Fetching the selected population.' : 'This city has no eligible observations under the current filters and validity policy. Adjust the filters or choose another city.')}</p>
          {!cohortLoading && <Button variant="outline" onClick={() => setSelectedCity(null)}>Explore matching cities</Button>}
        </CardContent></Card>
    </div>
  }

  // Empty Mode (no city selected, no metric selected)
  if (!selectedCity || !filteredCityData) {
    return (
      <div className="h-full w-full border-l bg-background">
        <div className="h-full overflow-y-auto">
          <div className="p-4 space-y-6">
            {/* Instructions Section */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">About</h2>

              <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
                <p>
                  PedX Visualizer analyzes pedestrian crossing behavior from publicly available street videos across the globe.
                  Using computer vision, we extract insights about crossing speeds, safety patterns, infrastructure usage,
                  and demographic trends to help urban planners and researchers understand pedestrian behavior. Each insight is automatically
                  derived from eligible video observations. Invalid classifiers are excluded; experimental measures require an explicit opt-in. Samples do not establish citywide behavior.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    How to Use
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <span>Use the search bar to find specific cities</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span>Expand filter categories to refine your search</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                      <span>Click on insights below to explore specific cities</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                      <span>Apply filters to update the globe visualization</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t">
                    <h4 className="text-sm font-semibold mb-2">Data Sources:</h4>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>• City demographics and infrastructure data</div>
                      <div>• Pedestrian behavior observations</div>
                      <div>• Environmental conditions and weather</div>
                      <div>• Vehicle traffic patterns</div>
                      <div>• Clothing and demographic factors</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top Insights Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Top Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Loading insights...
                  </div>
                ) : topInsights.length > 0 ? (
                  <div className="divide-y">
                    {topInsights.map((insight, index) => (
                      <ListItem
                        key={`${insight.city}-${index}`}
                        onClick={() => handleInsightClick(String(insight.city_id))}
                      >
                        <div className="flex items-start gap-3 flex-1">
                          <div className="text-2xl">
                            {getCountryEmoji(insight.country)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">
                              {insight.city}, {insight.country}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {insight.insight_text}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">
                                {insight.insight_category}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {insight.data_confidence} confidence
                              </span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </ListItem>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No insights available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  // City Mode (city selected)
  return (
    <div className="h-full w-full border-l bg-background">
      <div className="h-full overflow-y-auto">
        <div className="p-4 space-y-6">
          {/* City Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{getCountryEmoji(filteredCityData.country)}</span>
              <div>
                <h2 className="text-xl font-bold">{filteredCityData.city}</h2>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{filteredCityData.country}</span>
                  <Badge variant="outline" className="text-xs">
                    {filteredCityData.continent}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <div>Population: {filteredCityData.population?.toLocaleString() || 'N/A'}</div>
              <div>Location: {formatNumber(filteredCityData.latitude, 4)}, {formatNumber(filteredCityData.longitude, 4)}</div>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Eye className="w-4 h-4" />
                {filteredCityData.total_videos || 0} videos analyzed
              </div>
              {/* "Pedestrians" was ambiguous: this number is the count of rows in the
                  pedestrians table (the denominator of every rate metric shown below), which
                  under the dense_v2 pipeline is roughly a tenth of the pedestrians the
                  tracker actually counted. Both are labelled explicitly now. */}
              <div className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {filteredCityData.total_pedestrians || 0} analysed
                {cityDetails?.measured_behavior?.pedestrian_counts?.tracked
                  ? ` of ${cityDetails.measured_behavior.pedestrian_counts.tracked.toLocaleString()} tracked`
                  : ' pedestrians'}
              </div>
            </div>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleMetricCardClick('Crossing Speed')}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-medium">Reference Crossing Speed</span>
                  </div>
                  <LineChart className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-lg font-bold">{formatNumber(filteredCityData.avg_crossing_speed, 2)} m/s</div>
                <div className={`text-xs ${getMetricDelta('crossing_speed', filteredCityData.avg_crossing_speed).color}`}>
                  {getMetricDelta('crossing_speed', filteredCityData.avg_crossing_speed).formatted} vs global
                </div>
              </CardContent>
            </Card>

            {/* MEASURED walking speed — from PedX-Insight dense video tracking, unlike
                Crossing Speed above, which is an imported city-level constant.
                Sparse metric: shows "No data" (never 0) for cities without
                dense-tracked videos, and is only clickable when data exists. */}
            <Card
              className={filteredCityData.avg_measured_walking_speed != null
                ? "cursor-pointer hover:bg-muted/50 transition-colors"
                : "opacity-70"}
              onClick={() => {
                if (filteredCityData.avg_measured_walking_speed != null) {
                  handleMetricCardClick('Measured Walking Speed')
                }
              }}
              title="Measured from dense pedestrian tracking in this city's videos (PedX-Insight), unlike Crossing Speed which is an imported city-level constant"
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-teal-600" />
                    <span className="text-xs font-medium">Measured Walking Speed</span>
                  </div>
                  {filteredCityData.avg_measured_walking_speed != null && (
                    <LineChart className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                {filteredCityData.avg_measured_walking_speed != null ? (
                  <>
                    <div className="text-lg font-bold">{formatNumber(filteredCityData.avg_measured_walking_speed, 2)} m/s</div>
                    <div className={`text-xs ${getMetricDelta('measured_walking_speed', filteredCityData.avg_measured_walking_speed).color}`}>
                      {getMetricDelta('measured_walking_speed', filteredCityData.avg_measured_walking_speed).formatted} vs global (measured)
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Measured from {Number(filteredCityData.measured_speed_video_count) || 0} video{Number(filteredCityData.measured_speed_video_count) === 1 ? '' : 's'}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-bold text-muted-foreground">No data</div>
                    <div className="text-xs text-muted-foreground">
                      No dense-tracked videos yet (unlike Crossing Speed, this is measured, not imported)
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleMetricCardClick('Reference Crossing Time')}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-medium">Reference Crossing Time</span>
                  </div>
                  <LineChart className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-lg font-bold">{formatNumber(filteredCityData.avg_crossing_time, 1)}s</div>
                <div className={`text-xs ${getMetricDelta('crossing_time', filteredCityData.avg_crossing_time).color}`}>
                  {getMetricDelta('crossing_time', filteredCityData.avg_crossing_time).formatted} vs global
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleMetricCardClick('Risky Crossing')}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
                    <span className="text-xs font-medium">Risky Crossing</span>
                  </div>
                  <LineChart className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-lg font-bold">{rateDisplay('risky_crossing')}</div>
                <p className="text-xs text-muted-foreground">{rateEvidence('risky_crossing', 'risky_crossing_determined')}</p>
                {rateValue('risky_crossing') != null && (<div className={`text-xs ${getMetricDelta('risky_crossing_rate', rateValue('risky_crossing')).color}`}>
                  {getMetricDelta('risky_crossing_rate', rateValue('risky_crossing')).formatted} vs global
                </div>)}
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleMetricCardClick('Red Light Rate')}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-red-600" />
                    <span className="text-xs font-medium">Red Light Rate</span>
                  </div>
                  <LineChart className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-lg font-bold">{rateDisplay('run_red_light')}</div>
                <p className="text-xs text-muted-foreground">{rateEvidence('run_red_light', 'run_red_light_sample')}</p>
                {rateValue('run_red_light') != null && (<div className={`text-xs ${getMetricDelta('run_red_light_rate', rateValue('run_red_light')).color}`}>
                  {getMetricDelta('run_red_light_rate', rateValue('run_red_light')).formatted} vs global
                </div>)}
              </CardContent>
            </Card>

            <Card
              className="2xl:col-span-2 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleMetricCardClick('Crosswalk Usage')}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-medium">Crosswalk Usage</span>
                  </div>
                  <LineChart className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-lg font-bold">{rateDisplay('crosswalk_usage')}</div>
                <p className="text-xs text-muted-foreground">{rateEvidence('crosswalk_usage', 'crosswalk_usage_sample')}</p>
                {rateValue('crosswalk_usage') != null && (<div className={`text-xs ${getMetricDelta('crosswalk_usage_rate', rateValue('crosswalk_usage')).color}`}>
                  {getMetricDelta('crosswalk_usage_rate', rateValue('crosswalk_usage')).formatted} vs global
                </div>)}
              </CardContent>
            </Card>
          </div>

          {/* Temporal Data Drawer */}
          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DrawerContent className="max-h-[85vh]">
              <DrawerHeader className="text-center sm:text-center">
                <DrawerTitle className="text-center">
                  {selectedMetricForChart && temporalData ? temporalData.metric.name : selectedMetricForChart || 'Analysis History'}
                </DrawerTitle>
                <DrawerDescription className="text-center">
                  {selectedCity && temporalData
                    ? `Analysis history for ${filteredCityData?.city || selectedCity} over the last ${temporalData.dateRange.months} months`
                    : 'Analysis dates; this does not measure changes by filming date.'}
                  {temporalData?.notice && <span className="block mt-2 text-xs">{temporalData.notice}</span>}
                </DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-4 overflow-y-auto">
                {temporalLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-sm text-muted-foreground">Loading chart data...</div>
                  </div>
                ) : temporalData && temporalData.chartData.length > 0 ? (
                  <div className="space-y-4">
                    <ChartContainer
                      config={{
                        value: {
                          label: temporalData.metric.name,
                          color: "hsl(var(--chart-1))",
                        },
                      }}
                      className="h-[300px] w-full"
                    >
                      <AreaChart
                        accessibilityLayer
                        data={temporalData.chartData}
                        margin={{
                          left: 12,
                          right: 12,
                          top: 12,
                          bottom: 12,
                        }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          tickFormatter={(value) => value}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={<ChartTooltipContent indicator="line" />}
                        />
                        <Area
                          dataKey="value"
                          type="natural"
                          fill="var(--color-value)"
                          fillOpacity={0.4}
                          stroke="var(--color-value)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ChartContainer>
                    <div className="text-sm text-muted-foreground text-center">
                      <div className="font-medium mb-1">
                        {temporalData.metric.name}: {temporalData.chartData[temporalData.chartData.length - 1]?.value.toFixed(2)} {temporalData.metric.unit}
                      </div>
                      <div>
                        {new Date(temporalData.dateRange.start).toLocaleDateString()} - {new Date(temporalData.dateRange.end).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-sm text-muted-foreground text-center">
                      <p>No temporal data available for this metric.</p>
                      <p className="text-xs mt-2">Historical data tracking may not be enabled or data is insufficient.</p>
                    </div>
                  </div>
                )}
              </div>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button variant="outline">Close</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          {/* Top Insights */}
          {cityInsights && cityInsights.filter((i: CityInsight) => i.category !== 'meta').length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Key Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cityInsights
                  .filter((insight: CityInsight) => insight.category !== 'meta')
                  .sort((a: CityInsight, b: CityInsight) => b.relevance_score - a.relevance_score)
                  .slice(0, 4)
                  .map((insight: CityInsight) => (
                    <div key={insight.id} className="p-3 bg-muted/50 rounded-md border border-border/50">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          {getCategoryIcon(insight.category)}
                          <Badge
                            variant={
                              insight.data_confidence === 'high' ? 'default' :
                              insight.data_confidence === 'medium' ? 'secondary' :
                              'outline'
                            }
                            className="text-xs capitalize"
                          >
                            {insight.category}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {insight.data_confidence} confidence
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed">{insight.text}</p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Rankings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Rankings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {cityDetailsLoading ? (
                <div className="text-sm text-muted-foreground">Loading rankings...</div>
              ) : cityDetails ? (
                <>
                  {cityDetails.rankings.crossing_speed.rank && cityDetails.rankings.crossing_speed.total_cities && (
                    <div className="text-sm">
                      <span className="font-medium">{filteredCityData.city}</span> ranks #{cityDetails.rankings.crossing_speed.rank} out of {cityDetails.rankings.crossing_speed.total_cities} cities for crossing speed
                    </div>
                  )}
                  {/* Measured walking speed rank — only among cities with dense-tracked
                      videos (sparse metric; absent rank means no measured data, not last place) */}
                  {cityDetails.rankings.measured_walking_speed?.rank && cityDetails.rankings.measured_walking_speed?.total_cities ? (
                    <div className="text-sm">
                      <span className="font-medium">{filteredCityData.city}</span> ranks #{cityDetails.rankings.measured_walking_speed.rank} out of {cityDetails.rankings.measured_walking_speed.total_cities} cities with measured walking speed data
                    </div>
                  ) : null}
                  {cityDetails.risk_factors.length > 0 && (
                    <div className="text-sm">
                      Top risk factors: {cityDetails.risk_factors.slice(0, 3).map((rf, idx) => (
                        <span key={idx}>
                          {rf.factor} (+{rf.risk_increase.toFixed(0)}%)
                          {idx < Math.min(cityDetails.risk_factors.length, 3) - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">Ranking data not available</div>
              )}
            </CardContent>
          </Card>

          {/* Breakdowns */}
          <div className="space-y-4">
            {/* Environment */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Cloud className="w-4 h-4" />
                  Environment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cityDetailsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading environment data...</div>
                ) : cityDetails ? (
                  <>
                    {cityDetails.environment.weather.length > 0 && (
                      <div className="text-sm">
                        <span className="font-medium">Weather:</span> {cityDetails.environment.weather.map((w, idx) => (
                          <span key={idx}>
                            {w.percentage.toFixed(0)}% {w.type.toLowerCase()}
                            {idx < cityDetails.environment.weather.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {cityDetails.environment.daytime.length > 0 && (
                      <div className="text-sm">
                        <span className="font-medium">Day/Night:</span> {cityDetails.environment.daytime.map((d, idx) => (
                          <span key={idx}>
                            {d.percentage.toFixed(0)}% {d.type.toLowerCase()} crossings
                            {idx < cityDetails.environment.daytime.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Environment data not available</div>
                )}
              </CardContent>
            </Card>

            {/* Demographics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Demographics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cityDetailsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading demographics...</div>
                ) : cityDetails ? (
                  <>
                    {cityDetails.demographics.gender.length > 0 && (
                      <div className="text-sm">
                        <span className="font-medium">Gender:</span> {cityDetails.demographics.gender.map((g, idx) => (
                          <span key={idx}>
                            {g.percentage.toFixed(0)}% {g.type}
                            {idx < cityDetails.demographics.gender.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-sm">
                      <span className="font-medium">Age:</span> Avg {
                        (cityDetails?.avg_pedestrian_age !== null && cityDetails?.avg_pedestrian_age !== undefined && cityDetails.avg_pedestrian_age > 0)
                          ? formatNumber(cityDetails.avg_pedestrian_age, 1)
                          : (filteredCityData.avg_pedestrian_age && (typeof filteredCityData.avg_pedestrian_age === 'number' ? filteredCityData.avg_pedestrian_age > 0 : parseFloat(String(filteredCityData.avg_pedestrian_age)) > 0)
                              ? formatNumber(filteredCityData.avg_pedestrian_age, 1)
                              : 'N/A')
                        } years
                    </div>
                    {cityDetails.demographics.age.length > 0 && (
                      <div className="text-sm">
                        <span className="font-medium">Risky crossing by age:</span> {cityDetails.demographics.age.map((a, idx) => {
                          // A rate with no determined crossings behind it is "n/a", not 0%;
                          // n is shown so a 1-of-2 group can't read like a 50% finding.
                          const risky = a.risky_rate == null || !a.risky_n
                            ? 'n/a'
                            : `${a.risky_rate.toFixed(0)}%, n=${a.risky_n}`
                          return (
                            <span key={idx}>
                              {a.group} ({risky})
                              {idx < cityDetails.demographics.age.length - 1 ? ', ' : ''}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Demographics data not available</div>
                )}
              </CardContent>
            </Card>

            {/* Vehicles */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <CarIcon className="w-4 h-4" />
                  Vehicles
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cityDetailsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading vehicle data...</div>
                ) : cityDetails ? (
                  <>
                    {cityDetails.vehicles && cityDetails.vehicles.length > 0 ? (
                      <div className="text-sm">
                        <span className="font-medium">Top vehicles:</span> {cityDetails.vehicles.slice(0, 3).map((v, idx) => (
                          <span key={idx}>
                            {v.type.charAt(0).toUpperCase() + v.type.slice(1)} ({v.percentage.toFixed(0)}%)
                            {idx < Math.min(cityDetails.vehicles.length, 3) - 1 ? ', ' : ''}
                          </span>
                        ))}
                        <div className="text-xs text-muted-foreground mt-1">
                          (Distribution of vehicle types observed)
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No vehicle data available</div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Vehicle data not available</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Measured behaviour — PedX-Insight [S1] kinematics plus the six insight modules
              and pose. Only rendered for cities whose videos actually went through those
              modules; a missing group is omitted rather than shown as zero. */}
          {cityDetails?.measured_behavior && hasMeasuredBehavior(cityDetails.measured_behavior) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Measured Behaviour
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(() => {
                  const mb = cityDetails.measured_behavior!
                  const pct = (v: number | null) => (v === null ? null : `${(v * 100).toFixed(0)}%`)
                  return (
                    <>
                      {mb.crossing_speed?.mps != null && (
                        <div className="text-sm">
                          <span className="font-medium">Crossing speed:</span> {mb.crossing_speed.mps.toFixed(2)} m/s
                          <span className="text-xs text-muted-foreground"> (measured, {mb.crossing_speed.n} crossers)</span>
                        </div>
                      )}
                      {mb.pedestrian_kinematics && (
                        <div className="text-sm">
                          <span className="font-medium">Walking speed:</span> {mb.pedestrian_kinematics.walking_speed_mps?.toFixed(2) ?? '—'} m/s
                          <span className="text-xs text-muted-foreground"> (median of {mb.pedestrian_kinematics.n} tracks
                          {mb.pedestrian_kinematics.implausible_n > 0
                            ? `; ${mb.pedestrian_kinematics.implausible_n} implausible excluded`
                            : ''})</span>
                        </div>
                      )}
                      {mb.conflicts && (
                        <div className="text-sm">
                          <span className="font-medium">Conflicts (PET):</span> {mb.conflicts.severe ?? 0} severe, {mb.conflicts.moderate ?? 0} moderate
                          {mb.conflicts.min_pet_s != null && (
                            <span className="text-xs text-muted-foreground"> (closest {mb.conflicts.min_pet_s.toFixed(2)} s)</span>
                          )}
                        </div>
                      )}
                      {mb.vehicle_speed?.median_mps != null && (
                        <div className="text-sm">
                          <span className="font-medium">Vehicle speed:</span> {mb.vehicle_speed.median_mps.toFixed(1)} m/s median
                          {mb.vehicle_speed.p85_mps != null && `, ${mb.vehicle_speed.p85_mps.toFixed(1)} m/s p85`}
                        </div>
                      )}
                      {mb.flow && (
                        <div className="text-sm">
                          <span className="font-medium">Traffic flow:</span> {mb.flow.vehicles_per_min?.toFixed(0) ?? '—'} veh/min
                          {mb.flow.mean_headway_s != null && `, ${mb.flow.mean_headway_s.toFixed(1)} s headway`}
                          {mb.flow.platoon_frac != null && `, ${pct(mb.flow.platoon_frac)} platooned`}
                        </div>
                      )}
                      {mb.pose && (
                        <div className="text-sm">
                          <span className="font-medium">Looked before crossing:</span> {pct(mb.pose.look_before_cross_frac) ?? '—'}
                          {mb.pose.looked_both_ways_frac != null && (
                            <span className="text-xs text-muted-foreground"> ({pct(mb.pose.looked_both_ways_frac)} both ways)</span>
                          )}
                        </div>
                      )}
                      {mb.signal && (
                        <div className="text-sm">
                          <span className="font-medium">Signal behaviour:</span> {pct(mb.signal.anticipatory_start_frac) ?? '—'} anticipatory starts
                          {mb.signal.mean_red_exposure_s != null && `, ${mb.signal.mean_red_exposure_s.toFixed(1)} s mean red exposure`}
                        </div>
                      )}
                      {mb.micro_events && (
                        <div className="text-sm">
                          <span className="font-medium">Hesitation:</span> {pct(mb.micro_events.hesitation_rate) ?? '—'}
                          {mb.micro_events.evasive_events != null && `, ${mb.micro_events.evasive_events} evasive events`}
                        </div>
                      )}
                      {mb.social && (
                        <div className="text-sm">
                          <span className="font-medium">Social groups:</span> {mb.social.groups ?? 0} groups
                          {mb.social.grouped_pedestrians != null && `, ${mb.social.grouped_pedestrians} pedestrians in company`}
                        </div>
                      )}
                      {/* Provenance. total_pedestrians is not comparable across pipelines, so
                          say which one produced this city rather than letting the reader assume. */}
                      <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
                        {mb.pipeline.dense_v2 > 0 && `${mb.pipeline.dense_v2} video${mb.pipeline.dense_v2 > 1 ? 's' : ''} on the dense pipeline`}
                        {mb.pipeline.dense_v2 > 0 && (mb.pipeline.legacy_1hz + mb.pipeline.unversioned) > 0 && ', '}
                        {(mb.pipeline.legacy_1hz + mb.pipeline.unversioned) > 0 &&
                          `${mb.pipeline.legacy_1hz + mb.pipeline.unversioned} on the legacy 1 Hz pipeline (counts not comparable)`}
                      </div>
                    </>
                  )
                })()}
              </CardContent>
            </Card>
          )}

          {/* Videos Used */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Videos Analyzed
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm text-muted-foreground mb-2">
                {filteredCityData.total_videos || 0} videos {cityVideos.length > 0 ? '• Sample links:' : ''}
              </div>
              {cityVideos.length > 0 ? (
                <div className="space-y-1">
                  {cityVideos.slice(0, 5).map((video, index) => (
                    <Button
                      key={video.id}
                      variant="ghost"
                      size="sm"
                      className="h-auto p-2 justify-start text-left w-full"
                      onClick={() => window.open(`https://www.youtube.com/watch?v=${video.link}`, '_blank')}
                    >
                      <ExternalLink className="w-3 h-3 mr-2 flex-shrink-0" />
                      <span className="text-xs truncate">
                        Video {index + 1}: {video.video_name}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No video links available
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
