"use client"

import { MapPin, BarChart3, RefreshCw, Check, ChevronsUpDown } from "lucide-react"
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

  // Get unique cities from the data
  const uniqueCities = Array.from(new Set(cityData.map(city => city.city))).sort()

  const handleMetricToggle = (metricType: string, checked: boolean) => {
    if (checked) {
      setSelectedMetrics([...selectedMetrics, metricType])
    } else {
      setSelectedMetrics(selectedMetrics.filter(m => m !== metricType))
    }
  }

  const handleCitySelect = (cityName: string) => {
    const newSelectedCity = cityName === "all" ? null : cityName
    setSelectedCity(newSelectedCity)
    setCitySearchOpen(false)
  }

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Filters</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="p-4 space-y-6">
              {/* City Selection - Searchable */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Select City
                </label>
                
                {/* Custom Searchable City Selector */}
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
                
                {/* Click outside to close */}
                {citySearchOpen && (
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setCitySearchOpen(false)}
                  />
                )}
              </div>

              {/* Metrics Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Select Metrics
                </label>
                <Accordion type="multiple" className="w-full">
                  {metricData.map((metric) => (
                    <AccordionItem key={metric.id} value={metric.metric_type}>
                      <AccordionTrigger className="text-sm">
                        {metric.metric_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={metric.metric_type}
                              checked={selectedMetrics.includes(metric.metric_type)}
                              onCheckedChange={(checked) => 
                                handleMetricToggle(metric.metric_type, checked as boolean)
                              }
                            />
                            <label 
                              htmlFor={metric.metric_type}
                              className="text-sm text-muted-foreground cursor-pointer"
                            >
                              Show insights
                            </label>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {metric.description}
                          </p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>

              {/* Apply Filters Button */}
              <div className="pt-4">
                <Button 
                  onClick={applyFilters}
                  disabled={loading}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {loading ? "Loading..." : "Apply Filters"}
                </Button>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}