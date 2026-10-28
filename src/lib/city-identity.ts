import { pool } from '@/lib/database';
export class AmbiguousCityError extends Error {}
export async function resolveCityId(key: string): Promise<number | null> {
  if (/^\d+$/.test(key)) return Number(key);
  const stable = /^(geonames|place):/.test(key);
  const result = await pool.query(`SELECT id FROM cities WHERE ${stable ? 'external_city_id' : 'city'} = $1 ORDER BY id LIMIT 2`, [key.normalize('NFC')]);
  if (result.rows.length > 1) throw new AmbiguousCityError('Select a city identifier; this name exists in more than one location.');
  return result.rows[0]?.id ?? null;
}
