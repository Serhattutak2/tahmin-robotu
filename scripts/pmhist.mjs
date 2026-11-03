// Iki yillik fiyat analizi. Fiyat: baslamadan en az 2 saat onceki son deger. Oran: football-data kapanis oranlari.
// Kural ilk yarida secilir, ikinci yarida yalniz raporlanir.
import fs from "node:fs";
import { Elo, fdDate, sameTeam, num, devig } from "../lib/engine.mjs";
import { FD_LEAGUES, FD_SEASONS, EXTRA_LEAGUES, fdSeason, extraRows, mapLimit, getText } from "../lib/sources.mjs";
import { rps } from "../lib/stack.mjs";
const G = "https://gamma-api.polymarket.com", now = Date.now(), minDate = new Date(now - 730 * 864e5).toISOString(), LIMIT_MS = Number(process.env.PM_LIMIT_MIN || 70) * 6e4, t0 = Date.now();
const J = s => { try { return JSON.parse(s); } catch { return []; } }, pause = ms => new Promise(r => setTimeout(r, ms));
const TAGS = { football: ["epl", "la-liga", "bundesliga", "ligue-1", "serie-a", "ucl", "uel", "soccer"], basketball: ["nba", "basketball"] };
const events = new Map();
for (const [sport, tags] of Object.entries(TAGS)) for (const tag of tags) {
  for (let off = 0; off < 6000; off += 100) {
    let list; try { list = JSON.parse(await getText(`${G}/events?tag_slug=${tag}&closed=true&limit=100&offset=${off}&order=endDate&ascending=false&end_date_min=${minDate}`, 2)); } catch { break; }
    if (!Array.isArray(list) || !list.length) break;
    for (const e of list) if (/\d{4}-\d{2}-\d{2}$/.test(e.slug || "") && !events.has(e.slug)) events.set(e.slug, { ...e, sport });
    await pause(150);
  }
  console.log(tag, events.size);
}
const preTs = e => Math.floor(Date.parse(e.endDate) / 1000) - 2 * 3600;
async function price(token, end) {
  const r = JSON.parse(await getText(`https://clob.polymarket.com/prices-history?market=${token}&startTs=${end - 36 * 3600}&endTs=${end}&fidelity=60`, 2));
  const h = r?.history || []; return h.length ? h.at(-1).p : null;
}
const games = []; const list = [...events.values()].sort((a, b) => b.endDate.localeCompare(a.endDate)); let empty = 0;
await mapLimit(list, 4, async e => {
  if (Date.now() - t0 > LIMIT_MS) return;
  const [a, b] = String(e.title || "").split(/\s+vs\.?\s+/i); if (!a || !b) return;
  const end = preTs(e), g = { slug: e.slug, sport: e.sport, end: e.endDate, a: a.trim(), b: b.trim(), league: e.slug.split("-")[0] };
  const ms = e.markets || [];
  if (e.sport === "football") {
    const three = ms.filter(m => m.sportsMarketType === "moneyline"); if (three.length !== 3) return;
    for (const m of three) { const tok = J(m.clobTokenIds)[0], settled = J(m.outcomePrices).map(Number)[0], gi = String(m.groupItemTitle || ""), k = /^draw/i.test(gi) ? "pd" : gi.includes(g.a) || g.a.includes(gi) ? "pa" : "pb"; if (!tok) return; g[k] = await price(tok, end); g[`${k}Won`] = settled === 1 ? 1 : settled === 0 ? 0 : null; }
    if (!(g.pa > 0 && g.pb > 0 && g.pd > 0)) { empty++; return; }
    games.push(g); return;
  }
  const ml = ms.find(m => m.sportsMarketType === "moneyline"); if (!ml) return;
  const names = J(ml.outcomes), toks = J(ml.clobTokenIds), set = J(ml.outcomePrices).map(Number); if (names.length !== 2 || !toks[0]) return;
  const p0 = await price(toks[0], end); if (!(p0 > 0 && p0 < 1)) { empty++; return; }
  g.names = names; g.p = p0; g.win = set[0] === 1 ? 0 : set[1] === 1 ? 1 : null; if (g.win === null) return;
  g.lines = [];
  for (const type of ["totals", "spreads"]) {
    const top = ms.filter(m => m.sportsMarketType === type).sort((x, y) => (y.volumeNum || 0) - (x.volumeNum || 0))[0]; if (!top) continue;
    const tk = J(top.clobTokenIds)[0], st = J(top.outcomePrices).map(Number); if (!tk) continue;
    const q = await price(tk, end); if (q > 0 && q < 1 && (st[0] === 1 || st[0] === 0)) g.lines.push({ type, line: Number(top.line), p: q, won: st[0] });
  }
  games.push(g);
});
console.log("oyun", games.length, "bos", empty, "dk", (Date.now() - t0) / 6e4);
fs.mkdirSync("data", { recursive: true }); fs.writeFileSync("data/pmhist.json", JSON.stringify(games));
// ---- Futbol: bahis sirketi kapanis oranlariyla birlestir
const fdFiles = await mapLimit(["2425", "2526", "2627"].flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const fd = fdFiles.filter(f => f?.rows).flatMap(f => f.rows.map(r => ({ ...r, date: fdDate(r.Date) }))).filter(r => r.date && r.HomeTeam && r.FTHG !== "");
const tri = (r, k) => { const v = [num(r[`${k}H`]), num(r[`${k}D`]), num(r[`${k}A`])]; return v.every(Number.isFinite) ? v : null; };
const fb = [];
for (const g of games.filter(x => x.sport === "football")) {
  const d = Date.parse(g.end), r = fd.find(x => Math.abs(Date.parse(x.date) - d) < 2 * 864e5 && ((sameTeam(x.HomeTeam, g.a) && sameTeam(x.AwayTeam, g.b)) || (sameTeam(x.HomeTeam, g.b) && sameTeam(x.AwayTeam, g.a)))); if (!r) continue;
  const homeA = sameTeam(r.HomeTeam, g.a), raw = [homeA ? g.pa : g.pb, g.pd, homeA ? g.pb : g.pa];
  const s = raw[0] + raw[1] + raw[2], pm = raw.map(v => v / s), hs = +r.FTHG, as = +r.FTAG;
  fb.push({ end: g.end, pm, y: hs > as ? 0 : hs === as ? 1 : 2, b365: tri(r, "B365C"), avg: tri(r, "AvgC"), max: tri(r, "MaxC"), market: tri(r, "AvgC") && devig(tri(r, "AvgC")) });
}
fb.sort((a, b) => a.end.localeCompare(b.end));
const half = rows => [rows.slice(0, rows.length >> 1), rows.slice(rows.length >> 1)];
const stat = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, v) => a + v.v, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, v) => a + (v.v - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(v => v.v > 0).length, ortalamaOran: +(l.reduce((a, v) => a + v.o, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri: +roi.toFixed(4), alt: +(roi - 1.96 * se).toFixed(3), üst: +(roi + 1.96 * se).toFixed(3) }; };
function fbBets(rows, entry, edge, minO = 1.2, maxO = 6) { const out = []; for (const m of rows) { const e = m[entry]; if (!e) continue; let b = null; e.forEach((o, i) => { const ev = m.pm[i] * o - 1; if (o >= minO && o <= maxO && ev >= edge && (!b || ev > b.ev)) b = { i, o, ev }; }); if (b) out.push({ o: b.o, v: b.i === m.y ? b.o - 1 : -1 }); } return out; }
const [fA, fB] = half(fb), EDGES = [.01, .02, .03, .05, .08], ENTRIES = { "bet365 kapanış": "b365", "ortalama kapanış": "avg", "en yüksek kapanış": "max" };
const fbTable = Object.entries(ENTRIES).flatMap(([n, k]) => EDGES.map(e => ({ oran: n, avantaj: e, ilk: stat(fbBets(fA, k, e)), ikinci: stat(fbBets(fB, k, e)) })));
const fbBest = fbTable.filter(x => x.ilk.seçim >= 80).sort((a, b) => b.ilk.getiri - a.ilk.getiri)[0];
const av = (rows, f) => rows.length ? +(rows.reduce((a, m) => a + f(m), 0) / rows.length).toFixed(5) : null;
const quality = { maç: fb.length, polymarketRPS: av(fb.filter(m => m.market), m => rps(m.pm, m.y)), bahisRPS: av(fb.filter(m => m.market), m => rps(m.market, m.y)) };
// ---- Basketbol: Elo (yalniz sonuclardan) ve fiyat
const bk = games.filter(g => g.sport === "basketball").sort((a, b) => a.end.localeCompare(b.end)), byL = {}, rowsB = [];
for (const g of bk) { const e = (byL[g.league] ||= new Elo({ k: 18, home: 0 })), [x, y] = g.names, n = e.games(x, y); const E = e.expected(x, y); if (n >= 8) rowsB.push({ end: g.end, league: g.league, price: g.p, elo: E, win: g.win, lines: g.lines }); e.update(x, y, g.win === 0 ? 1 : 0, g.win === 0 ? 0 : 1); }
function bkBets(rows, w, edge) { const out = []; for (const r of rows) { const p = w * r.elo + (1 - w) * r.price, sides = [[p, r.price, 0], [1 - p, 1 - r.price, 1]]; let b = null; for (const [q, pr, i] of sides) { const o = 1 / pr, ev = q * o - 1; if (o >= 1.2 && o <= 6 && ev >= edge && (!b || ev > b.ev)) b = { o, ev, i }; } if (b) out.push({ o: b.o, v: b.i === r.win ? b.o - 1 : -1 }); } return out; }
const [bA, bB] = half(rowsB), bkTable = [.1, .2, .3, .5].flatMap(w => [.02, .03, .05, .08, .12].map(e => ({ eloAğırlığı: w, avantaj: e, ilk: stat(bkBets(bA, w, e)), ikinci: stat(bkBets(bB, w, e)) })));
const bkBest = bkTable.filter(x => x.ilk.seçim >= 80).sort((a, b) => b.ilk.getiri - a.ilk.getiri)[0];
// Fiyat bandi: fiyati oynasan ne olurdu (kalibrasyon)
const bands = [[.5, .6], [.6, .7], [.7, .8], [.8, .84]].map(([a, z]) => { const l = []; for (const r of rowsB) { const fav = r.price >= .5 ? r.price : 1 - r.price, won = r.price >= .5 ? r.win === 0 : r.win === 1; if (fav >= a && fav < z) l.push({ o: 1 / fav, v: won ? 1 / fav - 1 : -1 }); } return { bant: `${a}-${z}`, ...stat(l) }; });
const lineStats = ["totals", "spreads"].map(t => { const l = rowsB.flatMap(r => r.lines.filter(x => x.type === t)); const up = l.filter(x => x.p >= .5); return { tür: t, adet: l.length, ortalamaFiyat: +(l.reduce((a, x) => a + x.p, 0) / (l.length || 1)).toFixed(3), gerçekleşen: +(l.reduce((a, x) => a + x.won, 0) / (l.length || 1)).toFixed(3) }; });
const sampleDates = { futbol: [fb[0]?.end, fb.at(-1)?.end], basketbol: [rowsB[0]?.end, rowsB.at(-1)?.end] };
const accepted = { football: fbBest && fbBest.ilk.getiri > 0 && fbBest.ikinci.getiri > 0 ? fbBest : null, basketball: bkBest && bkBest.ilk.getiri > 0 && bkBest.ikinci.getiri > 0 ? bkBest : null };
const report = { generatedAt: new Date(now).toISOString(), dönemler: sampleDates, ham: { oyun: games.length, boş: empty, süreDk: +((Date.now() - t0) / 6e4).toFixed(1) }, futbol: { kalite: quality, tablo: fbTable, seçilen: fbBest || null }, basketbol: { maç: rowsB.length, tablo: bkTable, seçilen: bkBest || null, bantlar: bands, çizgiler: lineStats }, kabul: accepted };
fs.writeFileSync("docs/pmtest.json", JSON.stringify(report, null, 1));
fs.writeFileSync("config/pmrule.json", JSON.stringify({ football: accepted.football ? { edge: accepted.football.avantaj, entry: accepted.football.oran } : null, basketball: accepted.basketball ? { w: accepted.basketball.eloAğırlığı, edge: accepted.basketball.avantaj } : null, generatedAt: report.generatedAt }, null, 1));
console.log(JSON.stringify({ ...report, futbol: { kalite: quality, seçilen: fbBest }, basketbol: { maç: rowsB.length, seçilen: bkBest, bantlar: bands, çizgiler: lineStats } }));
