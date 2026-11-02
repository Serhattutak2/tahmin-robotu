// The Odds API ucretsiz plani (ayda 500 kredi). Lig basina 1 kredi: bir istekte ligin tum maclari ve bahis sirketleri gelir.
import { devig } from "./engine.mjs";
const BASE = "https://api.the-odds-api.com/v4";
const PRIORITY = ["soccer_turkey_super_league", "soccer_epl", "soccer_spain_la_liga", "soccer_italy_serie_a", "soccer_germany_bundesliga", "soccer_france_ligue_one", "soccer_uefa_champs_league", "soccer_uefa_europa_league", "basketball_nba", "basketball_euroleague"];
async function get(path, key) {
  const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`The Odds API HTTP ${r.status}`);
  return { body: await r.json(), remaining: Number(r.headers.get("x-requests-remaining")) };
}
export const listSports = key => get("/sports", key).then(x => x.body.filter(s => s.active && !s.has_outrights && /^(soccer|basketball)_/.test(s.key)));
export const fetchOdds = (sport, key) => get(`/sports/${sport}/odds?regions=eu&markets=h2h&oddsFormat=decimal`, key);
export const fetchScores = (sport, key) => get(`/sports/${sport}/scores?daysFrom=3`, key);
// En uzun suredir guncellenmeyen ligi sec; onemli ligler esitlikte onde.
export function chooseSports(sports, cache, n, now) {
  const age = k => now - (cache[k]?.fetchedAt || 0), pr = k => { const i = PRIORITY.indexOf(k); return i < 0 ? 99 : i; };
  return sports.map(s => s.key).filter(k => age(k) > 12 * 3600e3).sort((a, b) => (pr(a) < 99 ? age(a) * 2 : age(a)) === (pr(b) < 99 ? age(b) * 2 : age(b)) ? pr(a) - pr(b) : (pr(b) < 99 ? age(b) * 2 : age(b)) - (pr(a) < 99 ? age(a) * 2 : age(a))).slice(0, n);
}
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Bir olayi tek satira indirir: marji cikarilmis piyasa ortalamasi, Pinnacle varsa keskin kaynak, en iyi fiyat.
export function eventToCandidate(ev, title) {
  const basket = ev.sport_key.startsWith("basketball"), names = basket ? [ev.home_team, ev.away_team] : [ev.home_team, "Draw", ev.away_team];
  const books = [];
  for (const b of ev.bookmakers || []) {
    const m = b.markets?.find(x => x.key === "h2h"); if (!m) continue;
    const prices = names.map(n => m.outcomes.find(o => o.name === n)?.price);
    if (prices.every(p => Number.isFinite(p) && p > 1)) books.push({ key: b.key, title: b.title, prices });
  }
  if (books.length < 3) return { id: `toa-${ev.id}`, sport: basket ? "basketball" : "football", league: title, kickoff: ev.commence_time, date: ev.commence_time.slice(0, 10), home: ev.home_team, away: ev.away_team, fair: null };
  const fairs = books.map(b => devig(b.prices)), mean = names.map((_, i) => fairs.reduce((a, f) => a + f[i], 0) / fairs.length), pin = books.find(b => b.key === "pinnacle");
  const probs = pin ? devig(pin.prices) : mean, bestIdx = names.map((_, i) => books.reduce((x, b) => b.prices[i] > x.prices[i] ? b : x));
  return { id: `toa-${ev.id}`, sport: basket ? "basketball" : "football", league: title, sportKey: ev.sport_key, kickoff: ev.commence_time, date: ev.commence_time.slice(0, 10), home: ev.home_team, away: ev.away_team,
    fair: names.map((_, i) => 1 / probs[i]), probs, entry: bestIdx.map((b, i) => b.prices[i]), entryBooks: bestIdx.map(b => b.title), medianOdds: names.map((_, i) => median(books.map(b => b.prices[i]))), bookCount: books.length, sharp: !!pin, engine: "piyasa" };
}
