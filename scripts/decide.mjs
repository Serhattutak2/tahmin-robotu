// TEK SEFERLIK: matematik mi, oran mi, karisim mi daha karli? Secim 24-12 ay once, sinav son 12 ay.
import fs from "node:fs";
import { decide, devig, fdDate } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { rps } from "../lib/stack.mjs";
import { FEATURES, standardize, score, fitLogit } from "../lib/features.mjs";
import { MARKETS, marketProbs, fitCal, applyCal, outcome, recommend } from "../lib/markets.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const now = process.env.REVIEW_NOW ? Date.parse(process.env.REVIEW_NOW) : Date.now(), day = t => new Date(t).toISOString().slice(0, 10), d12 = day(now - 365 * 864e5), d24 = day(now - 730 * 864e5);
const files = await mapLimit(FD_SEASONS.flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const all = [];
for (const c of Object.keys(FD_LEAGUES)) {
  const rows = files.filter(f => f?.rows && f.c === c).sort((a, b) => a.s.localeCompare(b.s)).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, code: c, date: fdDate(r.Date) }))).filter(r => r.date && r.HomeTeam && r.FTHG !== "" && Number.isFinite(+r.FTHG));
  for (const rec of walkLeague(rows)) {
    if (rec.games < 10 || !rec.dc) continue;
    const r = rec.r, gh = +r.FTHG, ga = +r.FTAG, hth = r.HTHG === "" || r.HTHG === undefined ? null : +r.HTHG, hta = r.HTAG === "" || r.HTAG === undefined ? null : +r.HTAG, o = oddsOf(r);
    all.push({ date: r.date, code: c, f: rec.feats, gh, ga, hth, hta, y: gh > ga ? 0 : gh === ga ? 1 : 2, you: gh + ga > 2.5 ? 0 : 1, o, grid: marketProbs((rec.dx || rec.dc).lh * 0.5 + rec.dc.lh * 0.5, (rec.dx || rec.dc).la * 0.5 + rec.dc.la * 0.5), market: o.fair && devig(o.fair), ouMarket: o.ouFair && devig(o.ouFair) });
  }
}
const train = all.filter(d => d.date < d24), select = all.filter(d => d.date >= d24 && d.date < d12), final = all.filter(d => d.date >= d12), before = [...train, ...select];
const { mean, sd } = standardize(train.map(d => d.f)), z = f => f.map((v, i) => Math.max(-5, Math.min(5, (v - mean[i]) / sd[i])));
for (const d of all) d.x = z(d.f);
const mk = rows => rows.map(d => ({ x: d.x, y: d.y, off: null }));
// Her pazarin kalibrasyonu; sinav icin yalniz gecmisle.
const calFrom = rows => Object.fromEntries(MARKETS.map(m => [m.key, fitCal(rows.flatMap(d => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); return y === null ? [] : [[d.grid[m.key], y]]; }))]));
const calTrain = calFrom(train), calBefore = calFrom(before);
const pureTrain = fitLogit(mk(train), FEATURES.length), pureBefore = fitLogit(mk(before), FEATURES.length);
const fill = (rows, w, cal) => { for (const d of rows) { d.pure = score(d.x, w); d.dcp = [applyCal(d.grid.MS1, cal.MS1), applyCal(d.grid.MSX, cal.MSX), applyCal(d.grid.MS2, cal.MS2)]; const t = d.dcp[0] + d.dcp[1] + d.dcp[2]; d.dcp = d.dcp.map(v => v / t); d.over = applyCal(d.grid.U25, cal.U25); } };
fill(select, pureTrain, calTrain); fill(final, pureBefore, calBefore);
const dc3 = (o, a, b) => o && o[a] > 1 && o[b] > 1 ? 1 / (1 / o[a] + 1 / o[b]) : NaN;
// w: matematik agirligi. Pazarlar: 1X2, cifte sans, 2,5 Alt/Ust.
function play(rows, { w, src, edge, entry, minOdds = 1.3, maxOdds = 6 }) {
  let n = 0, pr = 0, sq = 0, won = 0; const per = {};
  for (const d of rows) {
    if (!d.o[entry] || !d.market) continue;
    const math = src === "pure" ? d.pure : d.dcp, p = [0, 1, 2].map(i => w * math[i] + (1 - w) * d.market[i]), e = d.o[entry], opts = [];
    const add = (name, prob, odd, win) => { if (odd >= minOdds && odd <= maxOdds && prob * odd - 1 >= edge) opts.push({ name, prob, odd, win, val: prob * odd - 1 }); };
    add("MS1", p[0], e[0], d.y === 0); add("MSX", p[1], e[1], d.y === 1); add("MS2", p[2], e[2], d.y === 2);
    add("1X", p[0] + p[1], dc3(e, 0, 1), d.y !== 2); add("X2", p[1] + p[2], dc3(e, 1, 2), d.y !== 0); add("12", p[0] + p[2], dc3(e, 0, 2), d.y !== 1);
    if (entry === "entry" && d.o.ouEntry && d.ouMarket) { const u = w * d.over + (1 - w) * d.ouMarket[0]; add("U25", u, d.o.ouEntry[0], d.you === 0); add("A25", 1 - u, d.o.ouEntry[1], d.you === 1); }
    const b = opts.sort((x, y) => y.val - x.val)[0]; if (!b) continue;
    const v = b.win ? b.odd - 1 : -1; n++; pr += v; sq += v * v; if (b.win) won++; (per[b.name] ||= { secim: 0, kar: 0 }); per[b.name].secim++; per[b.name].kar = +(per[b.name].kar + v).toFixed(2);
  }
  const roi = n ? pr / n : null;
  return { secim: n, kazanan: won, kar: +pr.toFixed(1), getiri: roi === null ? null : +roi.toFixed(4), guvenAlt: n ? +(roi - 1.96 * Math.sqrt(Math.max(sq / n - roi * roi, 0) / n)).toFixed(4) : null, guvenUst: n ? +(roi + 1.96 * Math.sqrt(Math.max(sq / n - roi * roi, 0) / n)).toFixed(4) : null, pazar: per };
}
const grid = []; for (const src of ["dc", "pure"]) for (const w of [0, .25, .5, .75, 1]) for (const edge of [.01, .02, .03, .05, .08, .12]) for (const entry of ["entry", "avg"]) grid.push({ src, w, edge, entry });
const scored = grid.map(c => ({ c, s: play(select, c) })).filter(x => x.s.secim >= 150).sort((a, b) => b.s.getiri - a.s.getiri);
const bestOf = f => scored.find(x => f(x.c));
const fam = { "Yalnız matematik": c => c.w === 1, "Karışım": c => c.w > 0 && c.w < 1, "Yalnız oran": c => c.w === 0 };
const comparison = Object.fromEntries(Object.entries(fam).map(([n, f]) => { const b = bestOf(f); return [n, b ? { ayar: b.c, secimDonemi: { secim: b.s.secim, kar: b.s.kar, getiri: b.s.getiri }, sinav: play(final, b.c) } : null]; }));
const winner = scored[0]?.c || null;
// Oran bilmeden 'en guvenli pazar' kurali: her pazarda tahmin ile gercek uyumu ve bet365 ile kar.
const safe = final.map(d => { const r = recommend(d.grid, calBefore, { exclude: d.hth === null ? MARKETS.filter(m => m.half).map(m => m.key) : [] })[0]; if (!r) return null; const m = MARKETS.find(x => x.key === r.key); return { key: r.key, won: outcome(m, d.gh, d.ga, d.hth, d.hta) === 1, min: r.minPlay, d }; }).filter(Boolean);
const realOdd = (k, d) => { const e = d.o.entry, u = d.o.ouEntry; return k === "MS1" ? e?.[0] : k === "MSX" ? e?.[1] : k === "MS2" ? e?.[2] : k === "1X" ? dc3(e, 0, 1) : k === "X2" ? dc3(e, 1, 2) : k === "12" ? dc3(e, 0, 2) : k === "U25" ? u?.[0] : k === "A25" ? u?.[1] : null; };
const safeByMarket = {}; let gAll = 0, gPr = 0; for (const s of safe) { const b = safeByMarket[s.key] ||= { maç: 0, kazanan: 0, ortalamaEnAz: 0 }; b.maç++; if (s.won) b.kazanan++; b.ortalamaEnAz += s.min; const o = realOdd(s.key, s.d); if (o && o >= s.min) { gAll++; gPr += s.won ? o - 1 : -1; } }
for (const b of Object.values(safeByMarket)) b.ortalamaEnAz = +(b.ortalamaEnAz / b.maç).toFixed(2);
const report = { generatedAt: new Date(now).toISOString(), donemler: { secim: select.length, sinav: final.length, secimBaslangic: d24, sinavBaslangic: d12 }, karsilastirma: comparison, kazananAyar: winner, kazananSinav: winner && play(final, winner), enGuvenliPazar: { dagilim: safeByMarket, gercekOranlaOynanan: gAll, kar: +gPr.toFixed(1), getiri: gAll ? +(gPr / gAll).toFixed(4) : null }, kalibrasyon: Object.fromEntries(MARKETS.map(m => { const pts = final.flatMap(d => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); return y === null ? [] : [[applyCal(d.grid[m.key], calBefore[m.key]), y]]; }); const n = pts.length || 1; return [m.key, { tahmin: +(pts.reduce((a, x) => a + x[0], 0) / n).toFixed(3), gercek: +(pts.reduce((a, x) => a + x[1], 0) / n).toFixed(3) }]; })) };
const cal = calFrom(all), pure = fitLogit(mk(all), FEATURES.length), m2 = standardize(all.map(d => d.f));
fs.writeFileSync("docs/decision.json", JSON.stringify(report, null, 1));
fs.writeFileSync("config/decision.json", JSON.stringify({ generatedAt: report.generatedAt, winner, cal, pure, mean: m2.mean, sd: m2.sd }));
console.log(JSON.stringify({ karsilastirma: comparison, kazanan: winner, kazananSinav: report.kazananSinav, enGuvenli: report.enGuvenliPazar }));
