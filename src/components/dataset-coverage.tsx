"use client"

import { useEffect, useState } from "react"
import { useFilter } from "@/contexts/FilterContext"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface Coverage {
  datasetReleaseIds: string[]
  coverageScope: 'active_release' | 'audit_archive'
  releaseStatus: 'active' | 'awaiting_validated_release'
  totalVideos: number
  eligibleVideos: number
  totalCities: number
  eligibleCities: number
  totalPedestrians: number
  eligiblePedestrians: number
  invalidMetricVideos: number
  experimentalMetricVideos: number
  intervalStatus: string
}

export function DatasetCoverage() {
  const { cityData, loading, granularFilters, refreshData } = useFilter()
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  const cohortReleaseKey = [...new Set(cityData.flatMap(city => {
    const releases = (city as unknown as { dataset_release_ids?: unknown }).dataset_release_ids
    return Array.isArray(releases) ? releases.map(String) : []
  }))].sort().join(',')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/status', { signal: controller.signal })
      .then(async response => {
        const result = await response.json()
        if (!response.ok || !result.success) throw new Error('Coverage unavailable')
        if (!controller.signal.aborted) {
          setCoverage(result.data)
          setError(false)
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [reload, cohortReleaseKey])

  const experimental = granularFilters.includeExperimental
  const archive = coverage?.coverageScope === 'audit_archive'
  return (
    <section aria-label="Dataset coverage" className="shrink-0 border-b bg-muted/30 px-4 py-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          Dataset coverage
          <Badge variant="outline" className={archive || experimental ? 'border-amber-400 text-amber-800' : ''}>
            {error ? 'Coverage unavailable' : !coverage ? 'Checking release' : archive ? 'Awaiting validated release' : experimental ? 'Experimental measurements' : 'Verified observations'}
          </Badge>
        </div>
        <span className="text-muted-foreground" aria-live="polite">
          {loading ? 'Updating view…' : `${cityData.length.toLocaleString()} locations in this view`}
        </span>
      </div>
      {error ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-muted-foreground">Coverage is unavailable. A verified dataset release may still need to be configured.</p>
          <Button size="sm" variant="outline" onClick={() => { setReload(value => value + 1); refreshData() }}>Retry</Button>
        </div>
      ) : !coverage ? (
        <p className="text-muted-foreground" role="status">Checking release and observation coverage…</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            {archive ? <>
              Audit archive: {coverage.totalVideos.toLocaleString()} videos ·{' '}
              {coverage.totalCities.toLocaleString()} locations ·{' '}
              {coverage.totalPedestrians.toLocaleString()} pedestrian records · 0 eligible for comparisons
            </> : <>
              {coverage.eligibleVideos.toLocaleString()} of {coverage.totalVideos.toLocaleString()} videos eligible ·{' '}
              {coverage.eligibleCities.toLocaleString()} of {coverage.totalCities.toLocaleString()} locations ·{' '}
              {coverage.eligiblePedestrians.toLocaleString()} of {coverage.totalPedestrians.toLocaleString()} pedestrian observations
            </>}
          </p>
          <p className="truncate text-muted-foreground" title={coverage.datasetReleaseIds.join(', ')}>
            Release: {coverage.datasetReleaseIds.length ? coverage.datasetReleaseIds.join(', ') : 'Awaiting validated release'}
          </p>
          {archive ? (
            <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">These counts describe stored audit data. A validated release with completed analyses and verified filming locations must be activated before comparisons are available.</p>
          ) : coverage.eligibleVideos === 0 && !experimental && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="max-w-xl text-amber-950">No videos currently meet comparison requirements. Completed analyses and verified filming locations are required before comparisons are available.</p>
            </div>
          )}
          {!archive && experimental && <p className="text-amber-800">Experimental measurements still require verified filming locations. Known-invalid classifiers remain excluded; available clips are not representative citywide surveys.</p>}
          {!archive && !loading && cityData.length === 0 && (experimental || coverage.eligibleVideos > 0) && (
            <p role="status" className="text-muted-foreground">No observations match this view. Adjust the filters or select another measure.</p>
          )}
        </>
      )}
    </section>
  )
}
