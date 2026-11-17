import fs from "node:fs";
const out = {}; const B = "https://gamma-api.polymarket.com/";
const get = async q => { const t = Date.now(); const r = await fetch(B + q); const s = await r.text(); let a = []; try { a = JSON.parse(s) } catch { } return { st: r.status, a, ms: Date.now() - t, kb: Math.round(s.length / 1024) }; };
const now = Date.now(), d = x => new Date(x).toISOString();
for (const q of [
  "events?tag_slug=sports&live=true&closed=false&limit=100",
  `events?tag_slug=sports&live=true&closed=false&limit=100&end_date_min=${d(now - 864e5)}`,
  `events?tag_slug=sports&live=true&closed=false&limit=100&start_time_min=${d(now - 4 * 36e5)}`,
  "markets?closed=false&limit=100&sports_market_types=moneyline&live=true",
  `markets?closed=false&limit=200&sports_market_types=moneyline,totals,spreads,both_teams_to_score&game_start_time_min=${d(now - 4 * 36e5)}&game_start_time_max=${d(now)}`,
  `markets?closed=false&limit=200&game_start_time_min=${d(now - 4 * 36e5)}&game_start_time_max=${d(now)}`,
]) { const { st, a, ms, kb } = await get(q); out[q] = { st, n: a.length, ms, kb, ex: a.slice(0, 2).map(e => ({ t: e.title || e.question, live: e.live, ended: e.ended, period: e.period, score: e.score, st: e.startTime || e.gameStartTime, smt: e.sportsMarketType, git: e.groupItemTitle, keys: Object.keys(e).length })), periods: [...new Set(a.map(e => e.period))].join(","), smts: [...new Set(a.map(e => e.sportsMarketType))].join(",") }; }
// soccer live sample full markets
const { a } = await get("events?tag_slug=soccer&live=true&closed=false&limit=100");
out.soccer = a.filter(e => !e.ended).slice(0, 4).map(e => ({ t: e.title, period: e.period, el: e.elapsed, score: e.score, st: e.startTime, gid: e.gameId, mk: (e.markets || []).filter(m => !m.closed).map(m => ({ q: m.question, git: m.groupItemTitle, smt: m.sportsMarketType, o: m.outcomes, bid: m.bestBid, ask: m.bestAsk, line: m.line, upd: m.updatedAt })) }));
fs.writeFileSync("docs/liveprobe.json", JSON.stringify(out, null, 1));
