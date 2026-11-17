import fs from "node:fs";
const out = {};
const O = { headers: { Origin: "https://serhattutak2.github.io" } };
for (const u of ["https://gamma-api.polymarket.com/events?limit=1&active=true&closed=false", "https://clob.polymarket.com/book?token_id=1", "https://clob.polymarket.com/midpoints"]) {
  try { const r = await fetch(u, O); out[u] = { st: r.status, acao: r.headers.get("access-control-allow-origin") }; } catch (e) { out[u] = String(e); }
}
const live = [];
for (const tag of ["soccer", "basketball", "volleyball", "nba", "tennis", "games"]) for (let off = 0; off < 1000; off += 100) {
  const r = await fetch(`https://gamma-api.polymarket.com/events?tag_slug=${tag}&active=true&closed=false&limit=100&offset=${off}`); if (!r.ok) break; const a = await r.json(); if (!a.length) break;
  for (const e of a) if (e.live || e.period || e.score) live.push({ tag, title: e.title, live: e.live, score: e.score, period: e.period, elapsed: e.elapsed, ended: e.ended, start: e.startTime || e.gameStartTime, keys: Object.keys(e).join(","), mk: (e.markets || []).slice(0, 6).map(m => ({ q: m.question, smt: m.sportsMarketType, o: m.outcomes, p: m.outcomePrices, bid: m.bestBid, ask: m.bestAsk, line: m.line, closed: m.closed, aob: m.acceptingOrders })) });
}
out.liveN = live.length; out.live = live.slice(0, 12);
// sports websocket/rest alternatives
try { const r = await fetch("https://gamma-api.polymarket.com/sports", O); out.sports = { st: r.status, acao: r.headers.get("access-control-allow-origin"), body: (await r.text()).slice(0, 600) }; } catch (e) { out.sports = String(e); }
fs.writeFileSync("docs/liveprobe.json", JSON.stringify(out, null, 1));
