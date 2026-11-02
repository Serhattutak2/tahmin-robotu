// Son iki mac gunu sinavi: kalibrasyon yalniz o gunlerden oncesiyle. Skor sadece sonunda karsilastirilir.
import fs from "node:fs";
import { fdDate, devig } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { MARKETS, byKey, marketProbs, fitCal, applyCal, outcome } from "../lib/markets.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const SAFE = 0.8, MIN = 1.2, MARGIN = 0.05;
const files = await mapLimit(FD_SEASONS.flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const all = [];
for (const c of Object.keys(FD_LEAGUES)) {
  const rows = files.filter(f => f?.rows && f.c === c).sort((a, b) => a.s.localeCompare(b.s)).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, date: fdDate(r.Date) }))).filter(r => r.date && r.HomeTeam && r.FTHG !== "" && Number.isFinite(+r.FTHG));
  for (const rec of walkLeague(rows)) { if (rec.games < 10 || !rec.dc) continue; const r = rec.r, l = k => rec.dx ? (rec.dx[k] + rec.dc[k]) / 2 : rec.dc[k]; all.push({ date: r.date, league: FD_LEAGUES[c], home: r.HomeTeam, away: r.AwayTeam, gh: +r.FTHG, ga: +r.FTAG, hth: r.HTHG === "" || r.HTHG === undefined ? null : +r.HTHG, hta: r.HTAG === "" || r.HTAG === undefined ? null : +r.HTAG, grid: marketProbs(l("lh"), l("la")), o: oddsOf(r), r }); }
}
const calFrom = rows => Object.fromEntries(MARKETS.map(m => [m.key, fitCal(rows.flatMap(d => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); return y === null ? [] : [[d.grid[m.key], y]]; }))]));
const dc = (o, a, b) => o?.[a] > 1 && o?.[b] > 1 ? +(1 / (1 / o[a] + 1 / o[b])).toFixed(2) : null;
const realOdd = (k, d) => { const e = d.o.entry, u = d.o.ouEntry; return { MS1: e?.[0], MSX: e?.[1], MS2: e?.[2], "1X": dc(e, 0, 1), X2: dc(e, 1, 2), 12: dc(e, 0, 2), U25: u?.[0], A25: u?.[1] }[k] ?? null; };
function choose(d, cal) {
  const list = MARKETS.map(m => { const p = applyCal(d.grid[m.key], cal[m.key]), real = realOdd(m.key, d), est = +((1 + MARGIN) / p).toFixed(2), odd = real ?? est; return { m, p, real, est, odd }; }).filter(x => x.odd >= MIN && (x.real !== null || x.est >= MIN)).sort((a, b) => b.p - a.p);
  return list[0] || null;
}
const row = (d, c) => { const y = outcome(c.m, d.gh, d.ga, d.hth, d.hta); return { date: d.date, league: d.league, match: `${d.home} – ${d.away}`, score: `${d.gh}-${d.ga}`, selection: c.m.label, odds: c.odd, gercekOran: c.real !== null, won: y === 1, p: +c.p.toFixed(3) }; };
const days = [...new Set(all.map(d => d.date))].sort().slice(-2), cut = days[0], cal = calFrom(all.filter(d => d.date < cut));
const test = all.filter(d => days.includes(d.date)).map(d => { const c = choose(d, cal); return c && c.p >= SAFE ? row(d, c) : null; }).filter(Boolean).sort((a, b) => b.p - a.p);
// Ayni kural son 12 ayda: esik basina sonuc. Kalibrasyon pencere oncesiyle.
const start = new Date(Date.parse(days[1]) - 365 * 864e5).toISOString().slice(0, 10), calY = calFrom(all.filter(d => d.date < start)), year = all.filter(d => d.date >= start).map(d => { const c = choose(d, calY); return c ? row(d, c) : null; }).filter(Boolean);
const sum = l => { const real = l.filter(x => x.gercekOran), pr = real.reduce((a, x) => a + (x.won ? x.odds - 1 : -1), 0); return { maç: l.length, kazanan: l.filter(x => x.won).length, gercekOranliMaç: real.length, gercekOranliKar: +pr.toFixed(1) }; };
const thresholds = Object.fromEntries([.7, .75, .8, .85].map(t => [t, sum(year.filter(x => x.p >= t))]));
const out = { days, generatedAt: new Date().toISOString(), SAFE, MIN, seçimler: test, özet: sum(test), yıl: thresholds };
fs.writeFileSync("docs/last2.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
