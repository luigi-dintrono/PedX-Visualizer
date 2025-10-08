"use client"

import { 
  MapPin, 
  BarChart3, 
  TrendingUp, 
  Clock, 
  Users, 
  Activity, 
  Filter, 
  Globe, 
  Cloud, 
  User, 
  Shirt, 
  Car,
  ChevronRight,
  ExternalLink,
  Calendar,
  Eye,
  AlertTriangle,
  Zap,
  Shield,
  Car as CarIcon,
  Gauge
} from "lucide-react"
import { useState, useEffect } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ListItem } from "@/components/ui/list-item"
import { Button } from "@/components/ui/button"
import { useFilter } from "@/contexts/FilterContext"
import { CityInsight } from "@/types/database"

interface TopInsight {
  city: string;
  country: string;
  continent: string;
  insight_text: string;
  insight_category: string;
  relevance_score: number;
  data_confidence: string;
}

interface CityVideo {
  id: number;
  video_name: string;
  link: string;
  duration_seconds: number;
  total_pedestrians: number;
  city: string;
  country: string;
}

export function InfoSidebar() {
  const { filteredCityData, selectedCity, setSelectedCity, cityData } = useFilter()
  const [topInsights, setTopInsights] = useState<TopInsight[]>([])
  const [cityVideos, setCityVideos] = useState<CityVideo[]>([])
  const [loading, setLoading] = useState(false)

  // Debug logging to see what's happening
  useEffect(() => {
    console.log('InfoSidebar - selectedCity:', selectedCity)
    console.log('InfoSidebar - filteredCityData:', filteredCityData)
  }, [selectedCity, filteredCityData])

  // Fetch top insights for Empty mode
  useEffect(() => {
    if (!selectedCity) {
      fetchTopInsights()
      setCityVideos([]) // Clear videos when no city selected
    } else {
      fetchCityVideos(selectedCity)
    }
  }, [selectedCity])

  const fetchTopInsights = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/insights/top?limit=5')
      const result = await response.json()
      if (result.success) {
        setTopInsights(result.data)
      }
    } catch (error) {
      console.error('Error fetching top insights:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCityVideos = async (city: string) => {
    try {
      const response = await fetch(`/api/cities/${encodeURIComponent(city)}/videos?limit=5`)
      const result = await response.json()
      if (result.success) {
        setCityVideos(result.data)
      }
    } catch (error) {
      console.error('Error fetching city videos:', error)
      setCityVideos([])
    }
  }

  const formatNumber = (value: string | number | null | undefined, decimals: number = 2): string => {
    if (value === null || value === undefined) return 'N/A'
    const num = typeof value === 'string' ? Number(value) : value
    return isNaN(num) ? 'N/A' : num.toFixed(decimals)
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

  // Empty Mode (no city selected)
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
                  generated from real-world observations, with confidence levels based on sample size.
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
                        onClick={() => handleInsightClick(insight.city)}
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
              <div className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {filteredCityData.total_pedestrians || 0} pedestrians
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                Last updated: {new Date().toLocaleDateString()}
              </div>
            </div>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-medium">Crossing Speed</span>
                </div>
                <div className="text-lg font-bold">1.86 m/s</div>
                <div className="text-xs text-green-600">+12% vs global</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-medium">Time to Start</span>
                </div>
                <div className="text-lg font-bold">2.3s</div>
                <div className="text-xs text-red-600">-8% vs global</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-medium">Risky Crossing</span>
                </div>
                <div className="text-lg font-bold">{formatNumber(filteredCityData.risky_crossing_rate, 1)}%</div>
                <div className="text-xs text-green-600">-5% vs global</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-red-600" />
                  <span className="text-xs font-medium">Red Light Rate</span>
                </div>
                <div className="text-lg font-bold">{formatNumber(filteredCityData.run_red_light_rate, 1)}%</div>
                <div className="text-xs text-red-600">+15% vs global</div>
              </CardContent>
            </Card>

            <Card className="col-span-2">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-green-600" />
                  <span className="text-xs font-medium">Crosswalk Usage</span>
                </div>
                <div className="text-lg font-bold">{formatNumber(filteredCityData.crosswalk_usage_rate, 1)}%</div>
                <div className="text-xs text-green-600">+8% vs global</div>
              </CardContent>
            </Card>
          </div>

          {/* Top Insights */}
          {filteredCityData.insights && filteredCityData.insights.filter((i: CityInsight) => i.category !== 'meta').length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Key Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {filteredCityData.insights
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
              <div className="text-sm">
                <span className="font-medium">{filteredCityData.city}</span> ranks #3 out of 47 cities for crossing speed
              </div>
              <div className="text-sm">
                Top 3 risk factors: Rain (+23%), Night (+18%), High vehicle density (+12%)
              </div>
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
                <div className="text-sm">
                  <span className="font-medium">Weather:</span> 70% sunny, 20% cloudy, 10% rain
                </div>
                <div className="text-sm">
                  <span className="font-medium">Day/Night:</span> 65% daytime crossings
                </div>
                <div className="text-sm">
                  <span className="font-medium">Infrastructure:</span> Crosswalks present, traffic lights available
                </div>
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
                <div className="text-sm">
                  <span className="font-medium">Gender:</span> 52% male, 48% female
                </div>
                <div className="text-sm">
                  <span className="font-medium">Age:</span> Avg {formatNumber(filteredCityData.avg_pedestrian_age, 1)} years
                </div>
                <div className="text-sm">
                  <span className="font-medium">Risk by age:</span> 18-30 (+15%), 50+ (-8%)
                </div>
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
                <div className="text-sm">
                  <span className="font-medium">Top vehicles:</span> Cars (45%), Buses (25%), Motorbikes (20%)
                </div>
                <div className="text-sm">
                  <span className="font-medium">Density impact:</span> High density increases risk by 22%
                </div>
              </CardContent>
            </Card>
          </div>

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
                  {cityVideos.map((video, index) => (
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