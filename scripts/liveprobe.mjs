import fs from "node:fs";
const out = {}; const G = "https://gamma-api.polymarket.com/events";
const get = async q => { const t = Date.now(); const r = await fetch(G + "?" + q); const s = await r.text(); let a = []; try { a = JSON.parse(s) } catch { } return { a, ms: Date.now() - t, kb: Math.round(s.length / 1024) }; };
for (const q of ["live=true&limit=100", "live=true&active=true&closed=false&limit=100", "tag_slug=sports&live=true&closed=false&limit=100", "tag_slug=sports&active=true&closed=false&limit=100&order=startTime&ascending=false"]) {
  const { a, ms, kb } = await get(q); out[q] = { n: a.length, ms, kb, liveTrue: a.filter(e => e.live).length, ended: a.filter(e => e.ended).length, sample: a.slice(0, 3).map(e => ({ t: e.title, live: e.live, ended: e.ended, score: e.score, period: e.period, el: e.elapsed, st: e.startTime, sport: e.sport?.sport || e.seriesSlug })) };
}
const live = [];
for (const tag of ["soccer", "basketball", "volleyball", "tennis"]) for (let off = 0; off < 1500; off += 100) {
  const { a } = await get(`tag_slug=${tag}&active=true&closed=false&limit=100&offset=${off}`); if (!a.length) break;
  for (const e of a) if (e.live && !e.ended) live.push({ tag, title: e.title, score: e.score, period: e.period, elapsed: e.elapsed, start: e.startTime, sport: e.seriesSlug, teams: e.teams, meta: e.eventMetadata, mk: (e.markets || []).filter(m => !m.closed).map(m => ({ q: m.question, smt: m.sportsMarketType, o: m.outcomes, p: m.outcomePrices, bid: m.bestBid, ask: m.bestAsk, line: m.line, aob: m.acceptingOrders, last: m.lastTradePrice, upd: m.updatedAt })) });
}
out.liveN = live.length; out.live = live.slice(0, 15);
fs.writeFileSync("docs/liveprobe.json", JSON.stringify(out, null, 1));
