"use client"

import { MapPin, BarChart3, TrendingUp, Clock, Users, Activity } from "lucide-react"

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

  return (
    <div className="h-full w-full border-l bg-background">
      <div className="h-full overflow-y-auto">
        <div className="p-4 space-y-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Information</h2>
          </div>
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
                          {filteredCityData.videos_analyzed}
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
                  </CardContent>
                </Card>
              )}

              {/* Metric Information */}
              {filteredMetricData && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {getMetricIcon(filteredMetricData.metric_type)}
                      {formatMetricType(filteredMetricData.metric_type)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {filteredMetricData.description}
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border">
                        <div className="font-medium text-green-900 dark:text-green-100 text-sm">Top City</div>
                        <div className="text-lg font-bold text-green-600 dark:text-green-400">
                          {filteredMetricData.top_city}
                        </div>
                        <div className="text-sm text-green-700 dark:text-green-300">
                          {formatNumber(filteredMetricData.top_city_value)} {filteredMetricData.metric_type.includes('speed') ? 'm/s' : 
                            filteredMetricData.metric_type.includes('time') ? 's' : 'm'}
                        </div>
                      </div>
                      <div className="bg-red-50 dark:bg-red-950 p-3 rounded-lg border">
                        <div className="font-medium text-red-900 dark:text-red-100 text-sm">Last City</div>
                        <div className="text-lg font-bold text-red-600 dark:text-red-400">
                          {filteredMetricData.last_city}
                        </div>
                        <div className="text-sm text-red-700 dark:text-red-300">
                          {formatNumber(filteredMetricData.last_city_value)} {filteredMetricData.metric_type.includes('speed') ? 'm/s' : 
                            filteredMetricData.metric_type.includes('time') ? 's' : 'm'}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Global Average</span>
                        <span className="text-lg font-bold">
                          {formatNumber(filteredMetricData.global_avg)} {filteredMetricData.metric_type.includes('speed') ? 'm/s' : 
                            filteredMetricData.metric_type.includes('time') ? 's' : 'm'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Global Median</span>
                        <span className="text-lg font-bold">
                          {formatNumber(filteredMetricData.global_median)} {filteredMetricData.metric_type.includes('speed') ? 'm/s' : 
                            filteredMetricData.metric_type.includes('time') ? 's' : 'm'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm">
                        {filteredMetricData.insight}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* No Selection State */}
              {!filteredCityData && !filteredMetricData && (
                <div className="space-y-4">

                  
                  {/* Controls Information */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        Globe Controls
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          <span>Select metrics in the sidebar to view heatmap</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span>Select a city to zoom in</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                          <span>Hover over points for details</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                          <span>Mouse: Drag to pan, Scroll to zoom</span>
                        </div>
                      </div>
                      
                      <div className="pt-3 border-t">
                        <h4 className="text-sm font-semibold mb-2">Available Metrics:</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <Activity className="w-3 h-3" />
                            <span>Crossing Speed</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3" />
                            <span>Time to Start</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3" />
                            <span>Waiting Time</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3 h-3" />
                            <span>Crossing Distance</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
        </div>
      </div>
    </div>
  )
}
