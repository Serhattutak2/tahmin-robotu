// Tam motor testi. Her sezon yalnizca onceki sezonlarla egitilir. Esikler dogrulama sezonlarinda secilir, test sezonlari yalniz raporlanir.
import fs from "node:fs";
import { decide, devig, fdDate } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { x12Features, ouFeatures, fit, softmax, rps, logLoss, FEATURE_NAMES } from "../lib/stack.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const VALID = ["2122", "2223", "2324"], TEST = ["2425", "2526", "2627"];
const jobs = FD_SEASONS.flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c })));
const files = await mapLimit(jobs, 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const recs = [];
for (const c of Object.keys(FD_LEAGUES)) {
  const rows = files.filter(f => f?.rows && f.c === c).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, code: c, date: fdDate(r.Date) }))).filter(r => r.date && r.HomeTeam && r.FTHG !== "" && r.FTHG !== undefined && Number.isFinite(+r.FTHG));
  recs.push(...walkLeague(rows));
}
const data = [];
for (const rec of recs) {
  const o = oddsOf(rec.r); if (!o.fair || !o.entry) continue;
  const hs = +rec.r.FTHG, as = +rec.r.FTAG, X = x12Features(rec, o.fair);
  if (!X) continue;
  data.push({ rec, o, X, y: hs > as ? 0 : hs === as ? 1 : 2, Xou: o.ouFair && o.ouEntry ? ouFeatures(rec, o.ouFair) : null, you: hs + as > 2.5 ? 0 : 1, season: rec.r.season, code: rec.r.code });
}
data.sort((a, b) => a.rec.r.date.localeCompare(b.rec.r.date));
const seasons = FD_SEASONS;
const coefBySeason = {};
for (const s of [...VALID, ...TEST]) {
  const past = data.filter(d => seasons.indexOf(d.season) < seasons.indexOf(s));
  const b = fit(past.map(d => ({ X: d.X, y: d.y })), 8), bo = fit(past.filter(d => d.Xou).map(d => ({ X: d.Xou, y: d.you })), 3);
  coefBySeason[s] = { x12: b, ou: bo };
  for (const d of data) if (d.season === s) { d.p = softmax(d.X, b); if (d.Xou) d.pou = softmax(d.Xou, bo); }
}
const scores = set => {
  const rows = data.filter(d => set.includes(d.season) && d.p); if (!rows.length) return null;
  const av = f => +(rows.reduce((a, d) => a + f(d), 0) / rows.length).toFixed(5);
  return { matches: rows.length, rps: { motor: av(d => rps(d.p, d.y)), piyasa: av(d => rps(devig(d.o.fair), d.y)), elo: av(d => rps(d.rec.elo, d.y)), dixonColes: av(d => rps(d.rec.dc.x12, d.y)), pi: av(d => rps(d.rec.pi, d.y)) },
    logLoss: { motor: av(d => logLoss(d.p, d.y)), piyasa: av(d => logLoss(devig(d.o.fair), d.y)) }, isabet: { motor: av(d => d.p.indexOf(Math.max(...d.p)) === d.y ? 1 : 0), piyasa: av(d => { const m = devig(d.o.fair); return m.indexOf(Math.max(...m)) === d.y ? 1 : 0; }) } };
};
function bets(set, cfg, entry = "entry") {
  const out = [];
  for (const d of data) {
    if (!set.includes(d.season) || !d.p) continue;
    const a = d.o[entry] && decide({ entry: d.o[entry], fair: d.o.fair, probs: d.p }, cfg), bb = d.pou && entry === "entry" && decide({ entry: d.o.ouEntry, fair: d.o.ouFair, probs: d.pou }, cfg);
    const c = [a && { ...a, market: "1x2", res: d.y, close: d.o.close }, bb && { ...bb, market: "ou", res: d.you, close: d.o.ouClose }].filter(Boolean).sort((x, y) => y.edge - x.edge)[0];
    if (c) out.push({ ...c, pr: c.index === c.res ? c.odds - 1 : -1, clv: c.close ? c.odds * devig(c.close)[c.index] - 1 : null, code: d.code, season: d.season });
  }
  return out;
}
function sumr(b) {
  if (!b.length) return { picks: 0 };
  const pr = b.reduce((a, x) => a + x.pr, 0), roi = pr / b.length, v = b.reduce((a, x) => a + (x.pr - roi) ** 2, 0) / b.length, se = Math.sqrt(v / b.length), cl = b.filter(x => x.clv !== null);
  return { picks: b.length, hitRate: +(b.filter(x => x.pr > 0).length / b.length).toFixed(4), avgOdds: +(b.reduce((a, x) => a + x.odds, 0) / b.length).toFixed(3), profit: +pr.toFixed(1), roi: +roi.toFixed(4), ciLow: +(roi - 1.96 * se).toFixed(4), ciHigh: +(roi + 1.96 * se).toFixed(4), clv: cl.length ? +(cl.reduce((a, x) => a + x.clv, 0) / cl.length).toFixed(4) : null };
}
const grid = []; for (const minEdge of [.01, .02, .03, .04, .06, .08, .12]) for (const maxOdds of [2.2, 3, 5, 10]) grid.push({ minEdge, maxOdds, minOdds: 1.3 });
const ranked = grid.map(cfg => ({ cfg, v: sumr(bets(VALID, cfg)) })).filter(x => x.v.picks >= 300).sort((a, b) => b.v.roi - a.v.roi);
const best = ranked[0]?.cfg || { minEdge: .05, maxOdds: 3, minOdds: 1.3 };
const finalX = fit(data.map(d => ({ X: d.X, y: d.y })), 8), finalOu = fit(data.filter(d => d.Xou).map(d => ({ X: d.Xou, y: d.you })), 3);
const report = { generatedAt: new Date().toISOString(), filesLoaded: files.filter(f => f?.rows).length, filesTotal: jobs.length, usable: data.length, sharpShare: +(data.filter(d => d.o.sharp).length / (data.length || 1)).toFixed(3), validationSeasons: VALID, testSeasons: TEST, selected: best,
  scoresValidation: scores(VALID), scoresTest: scores(TEST), validation: sumr(bets(VALID, best)), test: sumr(bets(TEST, best)), testAvgOdds: sumr(bets(TEST, best, "avg")), testMaxOdds: sumr(bets(TEST, best, "max")),
  bySeason: Object.fromEntries(TEST.map(s => [s, sumr(bets([s], best))])), byLeague: Object.fromEntries(Object.entries(FD_LEAGUES).map(([c, n]) => [n, sumr(bets(TEST, best).filter(b => b.code === c))])),
  weights: Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, finalX[i]])), topValidation: ranked.slice(0, 5).map(x => ({ ...x.cfg, ...x.v })) };
// Rastgele gecmis mac sinavi: motor maci oynanmadan once ne dedi, ne oldu?
let seed = 20261102; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pool = data.filter(d => TEST.includes(d.season) && d.p), lab = ["MS 1", "MS X", "MS 2"];
const samples = Array.from({ length: Math.min(30, pool.length) }, () => pool[Math.floor(rnd() * pool.length)]).map(d => {
  const i = d.p.indexOf(Math.max(...d.p)), b = decide({ entry: d.o.entry, fair: d.o.fair, probs: d.p }, best);
  return { date: d.rec.r.date, league: FD_LEAGUES[d.code], home: d.rec.r.HomeTeam, away: d.rec.r.AwayTeam, score: `${d.rec.r.FTHG}-${d.rec.r.FTAG}`, probs: d.p.map(v => +v.toFixed(3)), market: devig(d.o.fair).map(v => +v.toFixed(3)), top: lab[i], topHit: i === d.y, pick: b ? { selection: lab[b.index], odds: b.odds, won: b.index === d.y } : null, formH: d.rec.formH, formA: d.rec.formA, h2h: d.rec.h2h };
}).sort((a, b) => b.date.localeCompare(a.date));
fs.writeFileSync("docs/backtest.json", JSON.stringify({ ...report, samples }, null, 1));
fs.writeFileSync("config/strategy.json", JSON.stringify({ ...best, source: "backtest", generatedAt: report.generatedAt }, null, 1));
fs.writeFileSync("config/model.json", JSON.stringify({ x12: finalX, ou: finalOu, names: FEATURE_NAMES, generatedAt: report.generatedAt }, null, 1));
console.log(JSON.stringify({ ...report, byLeague: undefined }, null, 1));
