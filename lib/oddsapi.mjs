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

export const TOA_TO_FD = { soccer_epl: "E0", soccer_efl_champ: "E1", soccer_england_league1: "E2", soccer_england_league2: "E3", soccer_germany_bundesliga: "D1", soccer_germany_bundesliga2: "D2", soccer_italy_serie_a: "I1", soccer_italy_serie_b: "I2", soccer_spain_la_liga: "SP1", soccer_spain_segunda_division: "SP2", soccer_france_ligue_one: "F1", soccer_france_ligue_two: "F2", soccer_netherlands_eredivisie: "N1", soccer_belgium_first_div: "B1", soccer_portugal_primeira_liga: "P1", soccer_turkey_super_league: "T1", soccer_greece_super_league: "G1", soccer_spl: "SC0" };
const ALIAS = { "manchester united": "Man United", "manchester city": "Man City", "nottingham forest": "Nott'm Forest", "wolverhampton wanderers": "Wolves", "tottenham hotspur": "Tottenham", "brighton and hove albion": "Brighton", "west ham united": "West Ham", "newcastle united": "Newcastle", "leeds united": "Leeds", "sheffield united": "Sheffield United", "bayern munich": "Bayern Munich", "borussia dortmund": "Dortmund", "borussia monchengladbach": "M'gladbach", "bayer leverkusen": "Leverkusen", "atletico madrid": "Ath Madrid", "athletic bilbao": "Ath Bilbao", "paris saint germain": "Paris SG", "internazionale": "Inter", "inter milan": "Inter", "ac milan": "Milan", "galatasaray": "Galatasaray", "fenerbahce": "Fenerbahce", "besiktas": "Besiktas" };
export function fdTeam(name, teams, same) { const k = String(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim(); const a = ALIAS[k]; if (a && teams.includes(a)) return a; return teams.find(t => same(t, name)) || null; }
// Odds API olayini football-data satirina cevirir, boylece tam motor calisir.
export function eventToRow(ev, home, away) {
  const names = [ev.home_team, "Draw", ev.away_team], r = { HomeTeam: home, AwayTeam: away, date: ev.commence_time.slice(0, 10), Time: "", toa: ev }, books = (ev.bookmakers || []).map(b => { const m = b.markets?.find(x => x.key === "h2h"); return { key: b.key, title: b.title, prices: m ? names.map(n => m.outcomes.find(o => o.name === n)?.price) : [] }; }).filter(b => b.prices.length === 3 && b.prices.every(p => p > 1));
  if (books.length < 5) return null;
  const set = (k, p) => { r[`${k}H`] = String(p[0]); r[`${k}D`] = String(p[1]); r[`${k}A`] = String(p[2]); }, av = [0, 1, 2].map(i => books.reduce((a, b) => a + b.prices[i], 0) / books.length), mx = [0, 1, 2].map(i => Math.max(...books.map(b => b.prices[i])));
  set("Avg", av); set("Max", mx); const pin = books.find(b => b.key === "pinnacle"), b3 = books.find(b => b.key === "bet365"); if (pin) set("PS", pin.prices); if (b3) set("B365", b3.prices);
  r.bookCount = books.length; r.bestBooks = [0, 1, 2].map(i => books.find(b => b.prices[i] === mx[i]).title);
  return r;
}
