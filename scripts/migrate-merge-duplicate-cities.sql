-- ===============================================
-- MIGRATION: merge duplicate city rows created by inconsistent country spelling
-- ===============================================
-- `cities` is uniquely keyed on (city, country), so the same place stored once as
-- 'Germany' and once as 'DEU' (or 'Unknown') coexists as two rows. Per-city aggregates
-- (v_city_summary, mv_city_insights) then report two partial Berlins, each with a subset
-- of the videos, and the Globe plots both.
--
-- Two conservative operations only:
--   1. DELETE the four 'Unknown'-country rows that carry NO videos and NO pedestrians
--      (pure noise; zero data loss).
--   2. For same-name/different-country-spelling pairs, REPARENT the videos onto the row
--      with the human-readable country name and delete the now-empty ISO3 row.
--
-- Deliberately NOT touched: Munich (id 8) vs München (id 3453). Those are different city
-- NAMES (a transliteration choice), not a country-spelling artifact, so merging them is a
-- naming decision for a human rather than a data-integrity fix.
--
-- Everything runs inside the runner's transaction, and the pre-state of every affected row
-- is copied to cities_merge_backup_20260727 first, so the merge can be reconstructed.

SET lock_timeout = '5s';

-- 1. Backup the affected cities and the video->city mapping being changed.
CREATE TABLE IF NOT EXISTS cities_merge_backup_20260727 AS
SELECT c.*, now() AS backed_up_at
FROM cities c
WHERE c.city IN (SELECT city FROM cities GROUP BY city HAVING count(*) > 1);

CREATE TABLE IF NOT EXISTS videos_city_backup_20260727 AS
SELECT v.id AS video_id, v.city_id AS old_city_id, now() AS backed_up_at
FROM videos v
WHERE v.city_id IN (SELECT id FROM cities WHERE city IN
    (SELECT city FROM cities GROUP BY city HAVING count(*) > 1));

-- 2. Reparent videos from the ISO3-spelled row onto the full-name row, then drop the
--    emptied duplicate. Pairs are addressed explicitly so nothing is merged by accident.
DO $$
DECLARE
    pair RECORD;
BEGIN
    FOR pair IN
        SELECT * FROM (VALUES
            ('Berlin',       'DEU', 'Germany'),
            ('Durban',       'ZAF', 'South Africa'),
            ('Frankfurt',    'DEU', 'Germany'),
            ('Johannesburg', 'ZAF', 'South Africa'),
            ('Caracas',      'VEN', 'Venezuela'),
            ('München',      'DEU', 'Germany')
        ) AS t(city_name, iso_country, full_country)
    LOOP
        UPDATE videos v
           SET city_id = keep.id
          FROM cities keep, cities drop_row
         WHERE keep.city = pair.city_name AND keep.country = pair.full_country
           AND drop_row.city = pair.city_name AND drop_row.country = pair.iso_country
           AND v.city_id = drop_row.id;

        DELETE FROM cities d
         WHERE d.city = pair.city_name AND d.country = pair.iso_country
           AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.city_id = d.id);
    END LOOP;
END $$;

-- 3. Drop the empty 'Unknown'-country duplicates (no videos, no pedestrians).
DELETE FROM cities d
 WHERE d.country = 'Unknown'
   AND d.city IN (SELECT city FROM cities GROUP BY city HAVING count(*) > 1)
   AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.city_id = d.id);
