// Tutan ve tutmayan tavsiyelerden ders cikarir. Egitim 24 aydan eski, esik secimi 24-12 ay, sinav son 12 ay ve son 2 mac gunu.
import fs from "node:fs";
import { devig, fdDate } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { fitLogit, score, standardize } from "../lib/features.mjs";
import { MARKETS, marketProbs, impliedGoals, fitCal, applyCal, outcome } from "../lib/markets.mjs";
import { metaX, META_DIM, GROUP, GROUP_NAMES, estOdds } from "../lib/meta.mjs";
import { FD_LEAGUES, FD_SEASONS, ALL_LEAGUES, EXTRA_LEAGUES, fdSeason, extraRows, mapLimit } from "../lib/sources.mjs";
const now = process.env.REVIEW_NOW ? Date.parse(process.env.REVIEW_NOW) : Date.now(), day = t => new Date(t).toISOString().slice(0, 10), d12 = day(now - 365 * 864e5), d24 = day(now - 730 * 864e5), MIN = 1.2;
const files = await mapLimit(FD_SEASONS.flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const extras = await mapLimit(Object.keys(EXTRA_LEAGUES), 4, async c => ({ c, rows: await extraRows(c) }));
const dcOdd = (o, a, b) => o?.[a] > 1 && o?.[b] > 1 ? +(1 / (1 / o[a] + 1 / o[b])).toFixed(2) : null;
const all = [];
for (const c of Object.keys(ALL_LEAGUES)) {
  const src = c in EXTRA_LEAGUES ? (extras.find(x => x?.c === c)?.rows || []).map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => r.date >= "2017-07-01").sort((a, b) => a.date.localeCompare(b.date)) : files.filter(f => f?.rows && f.c === c).sort((a, b) => a.s.localeCompare(b.s)).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, date: fdDate(r.Date) })));
  const rows = src.filter(r => r.date && r.HomeTeam && r.FTHG !== "" && Number.isFinite(+r.FTHG));
  for (const rec of walkLeague(rows)) {
    if (rec.games < 10 || !rec.dc) continue; const o = oddsOf(rec.r); if (!o.fair) continue; const mk = devig(o.fair); if (!mk) continue;
    const r = rec.r, l = k => rec.dx ? (rec.dx[k] + rec.dc[k]) / 2 : rec.dc[k], goals = [l("lh"), l("la")], ig = impliedGoals(mk), e = o.entry, u = o.ouEntry;
    all.push({ date: r.date, code: c, league: ALL_LEAGUES[c], home: r.HomeTeam, away: r.AwayTeam, gh: +r.FTHG, ga: +r.FTAG, hth: r.HTHG === "" || r.HTHG === undefined ? null : +r.HTHG, hta: r.HTAG === "" || r.HTAG === undefined ? null : +r.HTAG, goals, f: rec.feats, grid: marketProbs(goals[0], goals[1]), mgrid: marketProbs(ig[0], ig[1]), real: { MS1: e?.[0], MSX: e?.[1], MS2: e?.[2], "1X": dcOdd(e, 0, 1), X2: dcOdd(e, 1, 2), 12: dcOdd(e, 0, 2), U25: u?.[0], A25: u?.[1] } });
  }
}
all.sort((a, b) => a.date.localeCompare(b.date));
const { mean, sd } = standardize(all.filter(d => d.date < d24).map(d => d.f));
for (const d of all) d.z = d.f.map((v, i) => Math.max(-4, Math.min(4, (v - mean[i]) / sd[i])));
const calFrom = rows => Object.fromEntries(MARKETS.map(m => [m.key, fitCal(rows.slice(-30000).flatMap(d => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); return y === null ? [] : [[d.grid[m.key], y]]; }))]));
// Bir mac icin aday pazarlar: robot oranini kendi hesaplar, 1,20 alti elenir.
function cands(d, cal) {
  return MARKETS.flatMap(m => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); if (y === null) return []; const pm = d.mgrid[m.key], p = applyCal(d.grid[m.key], cal[m.key]), est = estOdds(pm, m.key), real = d.real[m.key] ?? null, odd = real ?? est; if (odd < MIN || p < 0.6) return []; return [{ key: m.key, label: m.label, p, pm, est, real, odd, y }]; });
}
function fitMeta(rows, cal) { const tr = rows.flatMap(d => cands(d, cal).map(c => ({ x: metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), y: c.y ? 1 : 0, off: null }))); return fitLogit(tr, META_DIM, { classes: 2, iters: 140, lr: 0.3 }); }
const metaP = (x, m) => applyCal(score(x, m.w)[1], m.c);
// Ders modeli ve kalibrasyonu; yalniz verilen maclarla.
function model(rows, cal) { const w = fitMeta(rows, cal), pairs = []; rows.forEach((d, i) => { if (i % 5) return; for (const c of cands(d, cal)) pairs.push([score(metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), w)[1], c.y ? 1 : 0]); }); return { w, c: fitCal(pairs) }; }
// Secim: en cok tutacak olan degil, en yuksek beklenen kar.
function pick(d, cal, m) { const l = cands(d, cal).map(c => { const mp = metaP(metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), m); return { ...c, mp, ev: mp * c.odd - 1 }; }).sort((a, b) => b.ev - a.ev); return l[0] || null; }
function basePick(d, cal) { return cands(d, cal).sort((a, b) => b.p - a.p)[0] || null; }
const byOdds = l => Object.fromEntries([[1.2, 1.5], [1.5, 2], [2, 3], [3, 99]].map(([a, z]) => [`${a}-${z}`, sum(l.filter(x => x.odd >= a && x.odd < z))]));
const sum = l => { const r = l.filter(x => x.real !== null), pr = v => v.y ? v.odd - 1 : -1; return { maç: l.length, tutan: l.filter(x => x.y).length, başaBaşOran: l.filter(x => x.y).length ? +(l.length / l.filter(x => x.y).length).toFixed(3) : null, tahminiOranKar: +l.reduce((a, x) => a + pr(x), 0).toFixed(1), gercekOranlıMaç: r.length, gercekOranKar: +r.reduce((a, x) => a + pr(x), 0).toFixed(1) }; };
const tr = all.filter(d => d.date < d24), sel = all.filter(d => d.date >= d24 && d.date < d12), fin = all.filter(d => d.date >= d12), before = [...tr, ...sel];
const calA = calFrom(tr), wA = model(tr, calA);
const selPicks = sel.map(d => pick(d, calA, wA)).filter(Boolean);
const TS = [0, .005, .01, .02, .03, .04, .05, .07, .1, .15];
const grid = TS.map(t => ({ t, s: sum(selPicks.filter(x => x.ev >= t)) }));
// Hedef kar: secim yilinda seçim basina en yuksek kar, en az 150 secimle. Kazanma yuzdesi hedef degil.
const usable = grid.filter(x => x.s.maç >= 150).sort((a, b) => b.s.tahminiOranKar / b.s.maç - a.s.tahminiOranKar / a.s.maç), T = usable[0]?.t ?? .05, selProfit = usable[0] ? usable[0].s.tahminiOranKar > 0 : false;
const calB = calFrom(before), wB = model(before, calB);
const finPicks = fin.map(d => { const c = pick(d, calB, wB); return c && { ...c, d }; }).filter(Boolean), finBase = fin.map(d => basePick(d, calB)).filter(Boolean);
const chosen = finPicks.filter(x => x.ev >= T);
// Dersler: tutan/tutmayan karsilastirmasi
const by = (l, f) => { const o = {}; for (const x of l) { const k = f(x); (o[k] ||= []).push(x); } return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sum(v)])); };
const agree = x => { const g = x.p - x.pm; return g > 0.03 ? "Matematik piyasadan daha emin" : g < -0.03 ? "Piyasa matematikten daha emin" : "İkisi uyumlu"; };
const est = chosen.filter(x => x.real !== null), oddsErr = est.length ? +(est.reduce((a, x) => a + Math.abs(x.est - x.real), 0) / est.length).toFixed(3) : null;
// Gecen hafta: ders ve kalibrasyon yalniz o haftadan oncesiyle. Skor yalniz sonunda karsilastirilir.
const lastDay = all.at(-1).date, weekStart = day(Date.parse(lastDay) - 6 * 864e5), pre = all.filter(d => d.date < weekStart), calC = calFrom(pre), wC = model(pre, calC);
const weekRows = all.filter(d => d.date >= weekStart).map(d => { const c = pick(d, calC, wC); return c && c.ev >= T ? { date: d.date, league: d.league, match: `${d.home} – ${d.away}`, score: `${d.gh}-${d.ga}`, selection: c.label, oran: c.odd, gercekOran: c.real !== null, won: !!c.y, mp: +c.mp.toFixed(3), ev: +c.ev.toFixed(3), y: c.y, real: c.real, odd: c.odd } : null; }).filter(Boolean).sort((a, b) => b.ev - a.ev);
const addedLeagues = Object.fromEntries(Object.keys(EXTRA_LEAGUES).map(c => [EXTRA_LEAGUES[c], all.filter(d => d.code === c).length]));
const calF = calFrom(all), wF = model(all, calF);
const report = { generatedAt: new Date(now).toISOString(), seçimYılıKârlı: selProfit, seçimYılı: { başlangıç: d24, bitiş: d12 }, sınavYılı: { başlangıç: d12 }, sınavEşikleri: TS.map(t => ({ t, ...sum(finPicks.filter(x => x.ev >= t)) })), eşik: T, eşikDenemeleri: grid, sınav: { eskiKural: sum(finBase), yeniTümü: sum(finPicks), yeniSeçilen: sum(chosen) }, oranTahminHatası: oddsErr, dersler: { pazar: by(chosen, x => GROUP_NAMES[GROUP(x.key)]), lig: by(chosen, x => x.d.league), uyum: by(chosen, agree), oran: byOdds(chosen), enIyiPazarlar: Object.entries(by(chosen, x => x.label)).sort((a, b) => b[1].tahminiOranKar - a[1].tahminiOranKar).slice(0, 10), enKotuPazarlar: Object.entries(by(chosen, x => x.label)).sort((a, b) => a[1].tahminiOranKar - b[1].tahminiOranKar).slice(0, 10) }, geçenHafta: { başlangıç: weekStart, bitiş: lastDay, incelenenMaç: all.filter(d => d.date >= weekStart).length, özet: sum(weekRows), seçimler: weekRows }, ekLigler: addedLeagues, toplamMaç: all.length };
fs.writeFileSync("docs/learn.json", JSON.stringify(report, null, 1));
fs.writeFileSync("config/meta.json", JSON.stringify({ generatedAt: report.generatedAt, evThreshold: T, profitable: selProfit, weights: wF.w, metaCal: wF.c, cal: calF, mean, sd }));
console.log(JSON.stringify({ ...report, geçenHafta: { ...report.geçenHafta, seçimler: weekRows.length } }));
