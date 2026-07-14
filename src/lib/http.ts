// Shared Cache-Control for read-only API routes.
//
// The underlying data changes only when the manual data-import / materialized-view refresh
// runs (there is no live write path), so a short CDN cache window with a longer
// stale-while-revalidate tail is safe and removes repeated expensive aggregation queries for
// identical requests. Caching is keyed on the full URL (including query string), so different
// filter combinations are cached independently.
//
// NOTE: these routes read `request.url` / searchParams and are therefore dynamically rendered,
// which means a route-segment `export const revalidate = ...` has NO effect. This response
// header is the mechanism that actually caches (on the Vercel CDN and in the browser).
export const READ_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
} as const;
