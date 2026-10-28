// Releases update several related resources together. A URL-only CDN cache could mix
// a new status/denominator with an old ranking, so responses stay fresh until a cache
// keyed by dataset_release_id is explicitly introduced.
export const READ_CACHE_HEADERS = { 'Cache-Control': 'no-store' } as const;
