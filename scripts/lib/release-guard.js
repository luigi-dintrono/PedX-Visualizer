const PUBLISH_LOCK = 1735025711;
// Called inside the standalone transaction. The same lock serializes the check with
// publication, so a legacy single-stage import cannot mutate an activated snapshot.
async function assertStandaloneImportAllowed(db) {
  await db.query('SELECT pg_advisory_xact_lock($1)', [PUBLISH_LOCK]);
  const active = await db.query('SELECT dataset_release_id FROM dataset_releases WHERE is_active');
  if (active.rows.length) throw new Error('An active dataset release is immutable. Publish a complete staged release with npm run db:publish instead of a standalone import.');
}
module.exports = { assertStandaloneImportAllowed };
