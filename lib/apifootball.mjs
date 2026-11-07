// API-Football (ucretsiz plan: gunde 100 sorgu). Anahtar GitHub gizli degiskeninde: API_FOOTBALL_KEY.
const BASE = "https://v3.football.api-sports.io";
async function get(path, key) {
  const r = await fetch(BASE + path, { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json(), err = j.errors && (Array.isArray(j.errors) ? j.errors.join(" ") : Object.values(j.errors).join(" "));
  if (err) throw new Error(err);
  return j;
}
// Bir gunun tum sakat/cezali oyunculari. Sayfa sayisi sinirli tutulur.
export async function injuriesOn(date, key, maxPages = 3) {
  const out = []; let page = 1, total = 1, calls = 0;
  while (page <= total && page <= maxPages) {
    const j = await get(`/injuries?date=${date}&timezone=Europe/Istanbul${page > 1 ? `&page=${page}` : ""}`, key); calls++;
    total = j.paging?.total || 1;
    for (const x of j.response || []) out.push({ team: x.team?.name, player: x.player?.name, type: x.player?.type, reason: x.player?.reason, home: x.fixture?.teams?.home?.name, fixtureId: x.fixture?.id });
    page++;
  }
  return { list: out, calls };
}
