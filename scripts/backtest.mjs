// Gecmis oranlarla zaman sirali test. Esikler dogrulama sezonlarinda secilir, test sezonlari yalnizca raporlanir.
import fs from "node:fs";
import { Elo, eloProbs, decide, num, fdDate } from "../lib/engine.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const VALID = new Set(["2122", "2223", "2324"]), TEST = new Set(["2425", "2526", "2627"]);
const jobs = FD_SEASONS.flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c })));
const files = await mapLimit(jobs, 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const rows = [];
for (const f of files) if (f?.rows) for (const r of f.rows) { const date = fdDate(r.Date), hs = Number(r.FTHG), as = Number(r.FTAG); if (date && r.HomeTeam && Number.isFinite(hs) && Number.isFinite(as) && r.FTHG !== "") rows.push({ ...r, season: f.s, code: f.c, date, hs, as }); }
rows.sort((a, b) => a.date.localeCompare(b.date));
const elos = {}; const data = [];
for (const r of rows) {
  const e = (elos[r.code] ||= new Elo());
  const fair = [num(r.PSH), num(r.PSD), num(r.PSA)], avg = [num(r.AvgH), num(r.AvgD), num(r.AvgA)], b365 = [num(r.B365H), num(r.B365D), num(r.B365A)], max = [num(r.MaxH), num(r.MaxD), num(r.MaxA)];
  if (e.games(r.HomeTeam, r.AwayTeam) >= 10 && fair.every(Number.isFinite)) data.push({ season: r.season, code: r.code, fair, avg, b365, max, model: eloProbs(e.expected(r.HomeTeam, r.AwayTeam)), result: r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2 });
  e.update(r.HomeTeam, r.AwayTeam, r.hs, r.as);
}
function run(set, cfg, entryKey) {
  let picks = 0, won = 0, profit = 0, oddsSum = 0, sq = 0;
  for (const m of data) {
    if (!set.has(m.season)) continue;
    const d = decide({ fair: m.fair, entry: m[entryKey], model: m.model }, cfg);
    if (!d) continue;
    const pr = d.index === m.result ? d.odds - 1 : -1;
    picks++; profit += pr; sq += pr * pr; oddsSum += d.odds; if (pr > 0) won++;
  }
  const roi = picks ? profit / picks : null, se = picks ? Math.sqrt(Math.max(sq / picks - roi * roi, 0) / picks) : null;
  return { picks, won, hitRate: picks ? +(won / picks).toFixed(4) : null, avgOdds: picks ? +(oddsSum / picks).toFixed(3) : null, profit: +profit.toFixed(1), roi: roi === null ? null : +roi.toFixed(4), ciLow: picks ? +(roi - 1.96 * se).toFixed(4) : null, ciHigh: picks ? +(roi + 1.96 * se).toFixed(4) : null };
}
const grid = [];
for (const weight of [0, .05, .1, .2, .3]) for (const minEdge of [.01, .02, .03, .05, .08, .12]) for (const maxOdds of [2.5, 4, 8]) grid.push({ weight, minEdge, maxOdds, minOdds: 1.3 });
const scored = grid.map(cfg => ({ cfg, v: run(VALID, cfg, "b365") })).filter(x => x.v.picks >= 300).sort((a, b) => b.v.roi - a.v.roi);
const best = scored[0]?.cfg;
const report = { generatedAt: new Date().toISOString(), filesLoaded: files.filter(f => f?.rows).length, filesTotal: jobs.length, matches: rows.length, usable: data.length, entry: "bet365 maç öncesi oranı", fairSource: "Pinnacle (marjı çıkarılmış)", validationSeasons: [...VALID], testSeasons: [...TEST], selected: best || null, top5Validation: scored.slice(0, 5).map(x => ({ ...x.cfg, ...x.v })) };
if (best) {
  report.validation = run(VALID, best, "b365"); report.test = run(TEST, best, "b365");
  report.testAvgOdds = run(TEST, best, "avg"); report.testMaxOdds = run(TEST, best, "max");
  report.bySeason = Object.fromEntries([...TEST].map(s => [s, run(new Set([s]), best, "b365")]));
  report.byLeague = Object.fromEntries(Object.keys(FD_LEAGUES).map(c => { const old = data.filter(m => m.code === c); let p = 0, pr = 0; for (const m of old) { if (!TEST.has(m.season)) continue; const d = decide({ fair: m.fair, entry: m.b365, model: m.model }, best); if (d) { p++; pr += d.index === m.result ? d.odds - 1 : -1; } } return [FD_LEAGUES[c], { picks: p, roi: p ? +(pr / p).toFixed(4) : null }]; }));
  fs.writeFileSync("config/strategy.json", JSON.stringify({ ...best, source: "backtest", generatedAt: report.generatedAt }, null, 1));
}
fs.writeFileSync("docs/backtest.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, top5Validation: undefined, byLeague: undefined }, null, 1));
