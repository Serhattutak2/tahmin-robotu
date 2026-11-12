// Voleybol verisi kesfi (Polymarket): kapanmis ve acik etkinlikler, ligler, pazar turleri, tarih araligi.
import fs from "node:fs";
import { getText } from "../lib/sources.mjs";
const G = "https://gamma-api.polymarket.com", closed = [], open = [];
for (let off = 0; off < 5000; off += 100) { const l = JSON.parse(await getText(`${G}/events?tag_slug=volleyball&closed=true&limit=100&offset=${off}&order=endDate&ascending=false`, 2)); closed.push(...l); if (l.length < 100) break; }
for (let off = 0; off < 1000; off += 100) { const l = JSON.parse(await getText(`${G}/events?tag_slug=volleyball&closed=false&limit=100&offset=${off}`, 2)); open.push(...l); if (l.length < 100) break; }
const games = closed.filter(e => /\d{4}-\d{2}-\d{2}$/.test(e.slug || ""));
const pre = s => (s.slug || "").split("-")[0], cnt = (l, f) => Object.entries(l.reduce((a, x) => (a[f(x)] = (a[f(x)] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]);
const mk = {}; for (const e of games.slice(0, 300)) for (const m of e.markets || []) mk[m.sportsMarketType || m.groupItemTitle || "?"] = (mk[m.sportsMarketType || "?"] || 0) + 1;
const ex = games[0], out = { kapanmış: closed.length, maçlıKapanmış: games.length, önekler: cnt(games, pre).slice(0, 25), ilk: games.at(-1)?.endDate, son: games[0]?.endDate, pazarTürleri: mk, açık: open.length, açıkMaç: open.filter(e => /\d{4}-\d{2}-\d{2}$/.test(e.slug || "")).map(e => [e.slug, e.title, e.endDate]).slice(0, 20),
  örnek: ex && { slug: ex.slug, title: ex.title, score: ex.score, tags: (ex.tags || []).map(t => t.slug), markets: (ex.markets || []).slice(0, 4).map(m => ({ t: m.sportsMarketType, q: m.question, o: m.outcomes, p: m.outcomePrices, tok: m.clobTokenIds, line: m.line, vol: m.volumeNum })) } };
fs.writeFileSync("docs/vbexplore.json", JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 3000));
