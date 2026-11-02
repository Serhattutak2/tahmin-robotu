// TEK SEFERLIK parametre arastirmasi.
// Egitim: 24 aydan eski. Secim: 24-12 ay once. Son sinav: son 12 ay (yalniz bir kez raporlanir, secimde kullanilmaz).
import fs from "node:fs";
import { decide, devig, fdDate } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { rps } from "../lib/stack.mjs";
import { GROUPS, FEATURES, standardize, score, fitLogit } from "../lib/features.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const now = process.env.REVIEW_NOW ? Date.parse(process.env.REVIEW_NOW) : Date.now(), day = t => new Date(t).toISOString().slice(0, 10), d12 = day(now - 365 * 864e5), d24 = day(now - 730 * 864e5);
const files = await mapLimit(FD_SEASONS.flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const all = [];
for (const c of Object.keys(FD_LEAGUES)) {
  const rows = files.filter(f => f?.rows && f.c === c).sort((a, b) => a.s.localeCompare(b.s)).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, code: c, date: fdDate(r.Date) }))).filter(r => r.date && r.HomeTeam && r.FTHG !== "" && Number.isFinite(+r.FTHG));
  for (const rec of walkLeague(rows)) { if (rec.games < 10) continue; const o = oddsOf(rec.r); if (!o.fair) continue; const m = devig(o.fair), hs = +rec.r.FTHG, as = +rec.r.FTAG; if (!m) continue; all.push({ date: rec.r.date, code: c, f: rec.feats, m, off: m.map(v => Math.log(Math.max(v, 1e-4))), y: hs > as ? 0 : hs === as ? 1 : 2, o, hasRef: !!rec.r.Referee }); }
}
const train = all.filter(d => d.date < d24), select = all.filter(d => d.date >= d24 && d.date < d12), final = all.filter(d => d.date >= d12);
const { mean, sd } = standardize(train.map(d => d.f)), z = f => f.map((v, i) => Math.max(-5, Math.min(5, (v - mean[i]) / sd[i])));
for (const d of all) d.x = z(d.f);
const mk = (rows, off) => rows.map(d => ({ x: d.x, y: d.y, off: off ? d.off : null }));
const avg = (rows, f) => rows.reduce((a, d) => a + f(d), 0) / Math.max(rows.length, 1);
const paired = (rows, a, b) => { const v = rows.map(d => a(d) - b(d)), m = v.reduce((x, y) => x + y, 0) / (v.length || 1), se = Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / (v.length || 1) / (v.length || 1)) || 1e-9; return { fark: +m.toFixed(5), z: +(m / se).toFixed(2) }; };
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pure = fitLogit(mk(train, false), FEATURES.length), resid = fitLogit(mk(train, true), FEATURES.length);
const pred = (x, w, off) => score(x, w, off);
function importance(idxs, w, useOff, rows) {
  const perm = rows.map((_, i) => i); for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  return paired(rows.map((d, i) => ({ d, i })), ({ d, i }) => { const x = [...d.x]; for (const k of idxs) x[k] = rows[perm[i]].x[k]; return rps(pred(x, w, useOff ? d.off : null), d.y); }, ({ d }) => rps(pred(d.x, w, useOff ? d.off : null), d.y));
}
const idx = n => FEATURES.indexOf(n);
const groupTable = Object.entries(GROUPS).map(([g, names]) => { const ids = names.map(idx); return { grup: g, oranlarOlmadan: importance(ids, pure, false, select), oranlarinUstune: importance(ids, resid, true, select) }; }).sort((a, b) => b.oranlarOlmadan.fark - a.oranlarOlmadan.fark);
const featTable = FEATURES.map((n, i) => ({ parametre: n, oranlarOlmadan: importance([i], pure, false, select), oranlarinUstune: importance([i], resid, true, select) })).sort((a, b) => b.oranlarOlmadan.fark - a.oranlarOlmadan.fark);
// Secim: yalniz oranin ustune katkisi guvenilir gruplar (z>=2, secim doneminde).
const chosen = groupTable.filter(g => g.oranlarinUstune.z >= 2 && g.oranlarinUstune.fark > 0).map(g => g.grup), names = chosen.flatMap(g => GROUPS[g]), ids = names.map(idx);
const sub = (d) => ids.map(i => d.x[i]);
const trainAll = [...train, ...select];
const w2 = ids.length ? fitLogit(trainAll.map(d => ({ x: sub(d), y: d.y, off: d.off })), ids.length) : null, pure2 = fitLogit(mk(trainAll, false), FEATURES.length);
const engineP = d => w2 ? pred(sub(d), w2, d.off) : d.m;
function profit(rows, entry, edge) { let n = 0, pr = 0, sq = 0, w = 0; for (const d of rows) { const e = d.o[entry]; if (!e) continue; const x = decide({ entry: e, fair: d.o.fair, probs: engineP(d) }, { minEdge: edge, minOdds: 1.3, maxOdds: 5 }); if (!x) continue; const v = x.index === d.y ? x.odds - 1 : -1; n++; pr += v; sq += v * v; if (v > 0) w++; } const roi = n ? pr / n : null; return { secim: n, isabet: n ? +(w / n).toFixed(3) : null, kar: +pr.toFixed(1), getiri: roi === null ? null : +roi.toFixed(3), guvenAlt: n ? +(roi - 1.96 * Math.sqrt(Math.max(sq / n - roi * roi, 0) / n)).toFixed(3) : null }; }
const report = { generatedAt: new Date(now).toISOString(), donemler: { egitim: train.length, secim: select.length, sinav: final.length, secimBaslangic: d24, sinavBaslangic: d12 }, kapsam: { hakemVerisi: +avg(all, d => d.hasRef ? 1 : 0).toFixed(3), sutVerisiLigler: Object.keys(FD_LEAGUES).length, oyuncuVerisi: "Ücretsiz ve geçmişi olan güvenilir kaynak bulunamadı; bu çalışmaya dahil değil." }, gruplar: groupTable, parametreler: featTable, secilenGruplar: chosen,
  sinav: { rps: { motor: +avg(final, d => rps(engineP(d), d.y)).toFixed(5), piyasa: +avg(final, d => rps(d.m, d.y)).toFixed(5), sadeceIstatistik: +avg(final, d => rps(pred(d.x, pure2, null), d.y)).toFixed(5) }, motorPiyasayaFark: paired(final, d => rps(d.m, d.y), d => rps(engineP(d), d.y)), isabet: { motor: +avg(final, d => { const p = engineP(d); return p.indexOf(Math.max(...p)) === d.y ? 1 : 0; }).toFixed(4), piyasa: +avg(final, d => d.m.indexOf(Math.max(...d.m)) === d.y ? 1 : 0).toFixed(4), sadeceIstatistik: +avg(final, d => { const p = pred(d.x, pure2, null); return p.indexOf(Math.max(...p)) === d.y ? 1 : 0; }).toFixed(4) }, kar: Object.fromEntries([.01, .02, .03, .05, .08].map(e => [`%${e * 100}`, { bet365: profit(final, "entry", e), enYuksek: profit(final, "max", e) }])) } };
fs.writeFileSync("docs/study.json", JSON.stringify(report, null, 1));
const fitFinal = w2 ? fitLogit(all.map(d => ({ x: sub(d), y: d.y, off: d.off })), ids.length) : null, pureFinal = fitLogit(mk(all, false), FEATURES.length);
fs.writeFileSync("config/engine.json", JSON.stringify({ generatedAt: report.generatedAt, features: FEATURES, mean, sd, selected: names, selectedIds: ids, residual: fitFinal, pure: pureFinal }, null, 1));
console.log(JSON.stringify({ ...report, parametreler: featTable.slice(0, 12) }, null, 0));
