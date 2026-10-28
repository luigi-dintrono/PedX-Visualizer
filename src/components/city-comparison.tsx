"use client"

import { useState } from "react"
import { useFilter } from "@/contexts/FilterContext"
import { CityGlobeData } from "@/types/database"
import { METRICS, displayValue, finite } from "@/lib/metrics"

export function CityComparison() {
  const { cityData, selectedCity, selectedMetrics, granularFilters } = useFilter()
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const metricKey = selectedMetrics[0] || 'measured_crossing_speed'
  const metric = METRICS[metricKey]
  const left = cityData.find(city => String(city.id) === (first || selectedCity)) || cityData[0]
  const right = cityData.find(city => String(city.id) === second && city.id !== left?.id)
    || cityData.find(city => city.id !== left?.id)
  const field = (city: CityGlobeData, key?: string) => key ? (city as unknown as Record<string, unknown>)[key] : null
  const estimate = (city: CityGlobeData) => {
    const n = finite(field(city, metric?.sample))
    const value = finite(field(city, metric?.property))
    if (!metric || value == null) return 'Unavailable'
    if (metric.sample && (n == null || n < metric.minN)) return 'Insufficient observations'
    return `${displayValue(value, metric.unit)} ${metric.unit}`
  }
  const interval = (city: CityGlobeData) => {
    if (metric?.referenceOnly) return 'Reference value'
    const low = finite(field(city, `${metricKey}_lo`))
    const high = finite(field(city, `${metricKey}_hi`))
    if (low == null || high == null) return 'Unavailable for this cohort'
    return `${displayValue(low, metric.unit)}–${displayValue(high, metric.unit)} ${metric.unit}`
  }
  const select = (label: string, city: CityGlobeData | undefined, onChange: (value: string) => void) => (
    <label className="text-xs font-medium space-y-1">
      <span>{label}</span>
      <select aria-label={label} className="block w-full rounded-md border bg-background px-2 py-2 text-sm"
        value={city ? String(city.id) : ''} onChange={event => onChange(event.target.value)}>
        {!city && <option value="">No available location</option>}
        {cityData.map(item => <option key={item.id} value={String(item.id)}>{item.city}, {item.country}</option>)}
      </select>
    </label>
  )

  return (
    <section aria-label="Compare observation cohorts" className="shrink-0 max-h-[45dvh] overflow-auto border-b bg-background p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-sm">Compare available observations</h2>
        <p className="text-xs text-muted-foreground">{metric?.name || 'Selected metric'} · current filters apply to both locations.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {select('First location', left, setFirst)}
        {select('Second location', right, setSecond)}
      </div>
      {!left || !right ? <p className="text-sm text-muted-foreground">At least two locations are needed. Clear the city selection or adjust filters to broaden this view.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">{metric?.name} with observation support</caption>
            <thead><tr className="border-b"><th className="py-2 pr-3 font-medium">Evidence</th><th className="py-2 pr-3 font-medium">{left.city}, {left.country}</th><th className="py-2 font-medium">{right.city}, {right.country}</th></tr></thead>
            <tbody>
              <tr><th className="py-2 pr-3 text-xs font-normal text-muted-foreground">Videos</th>{[left, right].map(city => <td key={city.id}>{finite(city.total_videos)?.toLocaleString() ?? 'Unavailable'}</td>)}</tr>
              <tr><th className="py-2 pr-3 text-xs font-normal text-muted-foreground">Known observations</th>{[left, right].map(city => <td key={city.id}>{finite(field(city, metric?.sample))?.toLocaleString() ?? (metric?.referenceOnly ? 'Reference value' : 'Unavailable')}</td>)}</tr>
              <tr className="border-t"><th className="py-2 pr-3 text-xs font-normal text-muted-foreground">{metric?.referenceOnly ? 'Imported reference' : 'Estimate'}</th>{[left, right].map(city => <td key={city.id} className="py-2 pr-3 font-medium">{estimate(city)}</td>)}</tr>
              <tr><th className="py-2 pr-3 text-xs font-normal text-muted-foreground">95% interval</th>{[left, right].map(city => <td key={city.id} className="py-2 pr-3 text-xs text-muted-foreground">{interval(city)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{granularFilters.includeExperimental ? 'Experimental measurements from verified locations. ' : ''}These are observations from available videos, not representative citywide estimates. Missing or underpowered values remain unavailable.</p>
    </section>
  )
}
