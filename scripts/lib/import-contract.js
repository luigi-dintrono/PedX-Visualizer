// Validate every identity before replacing any imported partition.
function validateCoreRows(videos, pedestrians) {
  const links = new Set();
  for (const row of videos) {
    const link = String(row.link || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(link)) throw new Error(`Invalid video identity: ${link}`);
    if (links.has(link)) throw new Error(`Duplicate video identity: ${link}`);
    if (!String(row.city || '').trim()) throw new Error(`Missing city for ${link}`);
    links.add(link);
  }
  const tracks = new Set();
  for (const row of pedestrians) {
    const link = String(row.link || '').trim();
    const id = Number(row.track_id);
    if (!links.has(link)) throw new Error(`Pedestrian references absent video: ${link}`);
    if (!String(row.track_id ?? '').trim() || !Number.isSafeInteger(id) || id < 0) {
      throw new Error(`Invalid track identity: ${link}/${row.track_id}`);
    }
    const key = `${link}/${id}`;
    if (tracks.has(key)) throw new Error(`Duplicate track identity: ${key}`);
    tracks.add(key);
  }
  return { videos: links.size, pedestrians: tracks.size };
}
module.exports = { validateCoreRows };
