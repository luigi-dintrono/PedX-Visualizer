"use client"

import { MapPin, BarChart3, TrendingUp, Clock, Users, Activity, Filter, Globe, Cloud, User, Shirt, Car } from "lucide-react"

// Using regular div structure for resizable panel
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useFilter } from "@/contexts/FilterContext"

export function InfoSidebar() {
  const { filteredCityData, filteredMetricData, selectedCity, selectedMetrics } = useFilter()

  const formatMetricType = (type: string) => {
    return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  const formatNumber = (value: string | number | null | undefined, decimals: number = 2): string => {
    if (value === null || value === undefined) return 'N/A'
    const num = typeof value === 'string' ? Number(value) : value
    return isNaN(num) ? 'N/A' : num.toFixed(decimals)
  }

  const getMetricIcon = (type: string) => {
    switch (type) {
      case 'crossing_speed':
        return <Activity className="w-4 h-4" />
      case 'time_to_start':
        return <Clock className="w-4 h-4" />
      case 'waiting_time':
        return <Clock className="w-4 h-4" />
      case 'crossing_distance':
        return <MapPin className="w-4 h-4" />
      default:
        return <BarChart3 className="w-4 h-4" />
    }
  }

  const getFilterIcon = (category: string) => {
    switch (category) {
      case 'city-context':
        return <Globe className="w-4 h-4" />
      case 'environmental':
        return <Cloud className="w-4 h-4" />
      case 'behavior':
        return <Users className="w-4 h-4" />
      case 'demographics':
        return <User className="w-4 h-4" />
      case 'clothing':
        return <Shirt className="w-4 h-4" />
      case 'vehicles':
        return <Car className="w-4 h-4" />
      default:
        return <Filter className="w-4 h-4" />
    }
  }

  return (
    <div className="h-full w-full border-l bg-background">
      <div className="h-full overflow-y-auto">
        <div className="p-4 space-y-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Analytics & Insights</h2>
          </div>

          {/* Active Filters Summary */}
          {selectedCity && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Active Filters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3" />
                  <span className="text-sm">City: <strong>{selectedCity}</strong></span>
                </div>
                {selectedMetrics.length > 0 && (
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-3 h-3" />
                    <span className="text-sm">Metrics: <strong>{selectedMetrics.length} selected</strong></span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* City Information */}
          {filteredCityData && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  {filteredCityData.city}, {filteredCityData.country}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border">
                    <div className="font-medium text-blue-900 dark:text-blue-100 text-sm">Population</div>
                    <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                      {filteredCityData.population?.toLocaleString() || 'N/A'}
                    </div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border">
                    <div className="font-medium text-green-900 dark:text-green-100 text-sm">Videos Analyzed</div>
                    <div className="text-xl font-bold text-green-600 dark:text-green-400">
                      {filteredCityData.videos_analyzed || 0}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Crossing Speed</span>
                    <Badge variant="outline">
                      Rank #{filteredCityData.crossing_speed_rank}
                    </Badge>
                  </div>
                  <div className="text-2xl font-bold">
                    {formatNumber(filteredCityData.crossing_speed_avg)} m/s
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {filteredCityData.crossing_speed_insight}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Time to Start</span>
                    <Badge variant="outline">
                      Rank #{filteredCityData.quickest_to_start_rank}
                    </Badge>
                  </div>
                  <div className="text-2xl font-bold">
                    {formatNumber(filteredCityData.time_to_start_crossing_avg)}s
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {filteredCityData.time_to_start_insight}
                  </p>
                </div>

                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Crossing Speed Percentile</span>
                    <span className="text-sm font-bold">
                      {formatNumber(filteredCityData.crossing_speed_percentile * 100, 1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Time to Start Percentile</span>
                    <span className="text-sm font-bold">
                      {formatNumber(filteredCityData.time_to_start_percentile * 100, 1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Analytics Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Analytics Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border">
                  <div className="font-medium text-green-900 dark:text-green-100 text-sm">Cities in Dataset</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {filteredCityData ? 1 : 'Multiple'}
                  </div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border">
                  <div className="font-medium text-blue-900 dark:text-blue-100 text-sm">Total Videos</div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {filteredCityData?.videos_analyzed || 'N/A'}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Filter Categories Available:</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    {getFilterIcon('city-context')}
                    <span>City Context</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getFilterIcon('environmental')}
                    <span>Environmental</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getFilterIcon('behavior')}
                    <span>Behavior</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getFilterIcon('demographics')}
                    <span>Demographics</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getFilterIcon('clothing')}
                    <span>Clothing</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getFilterIcon('vehicles')}
                    <span>Vehicles</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Usage Instructions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                How to Use Filters
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
                  <span>Apply filters to update the globe visualization</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span>Use sliders for range-based filtering</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span>Toggle switches for boolean filters</span>
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
      </div>
    </div>
  )
}
