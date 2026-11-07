// Son 3 yil sinavi: sitedeki futbol kurallari, oran en az 1,30, bet365 (Melbet benzeri) ve en yuksek oranla.
// Hafta hafta tekrar oynatma. Her mac: o tarihe kadarki 5 yillik takim verisi, tahmin, sonra sonuc.
// Motor agirliklari ceyrekte bir, yalniz o tarihten onceki maclarla yenilenir.
import fs from "node:fs";
import { devig, fdDate, num } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { fitLogit, score, standardize } from "../lib/features.mjs";
import { MARKETS, marketProbs, impliedGoals, fitCal, applyCal, outcome } from "../lib/markets.mjs";
import { metaX, META_DIM, estOdds } from "../lib/meta.mjs";
import { FD_SEASONS, ALL_LEAGUES, EXTRA_LEAGUES, fdSeason, extraRows, mapLimit } from "../lib/sources.mjs";
const now = process.env.REVIEW_NOW ? Date.parse(process.env.REVIEW_NOW) : Date.now(), day = t => new Date(t).toISOString().slice(0, 10), start = day(Date.now() - 3 * 365.25 * 864e5), MIN = 1.2, FIVE = 5 * 365.25 * 864e5;
const fdCodes = Object.keys(ALL_LEAGUES).filter(c => !(c in EXTRA_LEAGUES));
const files = await mapLimit(FD_SEASONS.flatMap(s => fdCodes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) })), extras = await mapLimit(Object.keys(EXTRA_LEAGUES), 4, async c => ({ c, rows: await extraRows(c) }));
const dcOdd = (o, a, b) => o?.[a] > 1 && o?.[b] > 1 ? +(1 / (1 / o[a] + 1 / o[b])).toFixed(2) : null, all = [];
const fact = [1]; for (let i = 1; i < 10; i++) fact[i] = fact[i - 1] * i; const po = (l, k) => Math.exp(-l) * l ** k / fact[k];
const likelyScore = (a, b) => { let best = [0, 0], v = -1; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const p = po(a, i) * po(b, j); if (p > v) { v = p; best = [i, j]; } } return best; };
for (const c of Object.keys(ALL_LEAGUES)) {
  const src = c in EXTRA_LEAGUES ? (extras.find(x => x?.c === c)?.rows || []).map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => r.date >= "2017-07-01").sort((a, b) => a.date.localeCompare(b.date)) : files.filter(f => f?.rows && f.c === c).sort((a, b) => a.s.localeCompare(b.s)).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, date: fdDate(r.Date) })));
  const hist = new Map(), rows = src.filter(r => r.date && r.HomeTeam && r.FTHG !== "" && Number.isFinite(+r.FTHG));
  const five = (team, t) => { const l = (hist.get(team) || []).filter(m => t - m.t <= FIVE), n = l.length; if (!n) return null; return { maç: n, g: l.filter(m => m.gf > m.ga).length, b: l.filter(m => m.gf === m.ga).length, m: l.filter(m => m.gf < m.ga).length, atılan: +(l.reduce((a, m) => a + m.gf, 0) / n).toFixed(2), yenilen: +(l.reduce((a, m) => a + m.ga, 0) / n).toFixed(2) }; };
  for (const rec of walkLeague(rows)) {
    const r = rec.r, t = Date.parse(r.date), gh = +r.FTHG, ga = +r.FTAG, fh = five(r.HomeTeam, t), fa = five(r.AwayTeam, t);
    (hist.get(r.HomeTeam) || hist.set(r.HomeTeam, []).get(r.HomeTeam)).push({ t, gf: gh, ga }); (hist.get(r.AwayTeam) || hist.set(r.AwayTeam, []).get(r.AwayTeam)).push({ t, gf: ga, ga: gh });
    if (rec.games < 10 || !rec.dc) continue; const o = oddsOf(r); if (!o.fair) continue; const mk = devig(o.fair); if (!mk) continue;
    const l = k => rec.dx ? (rec.dx[k] + rec.dc[k]) / 2 : rec.dc[k], goals = [l("lh"), l("la")], ig = impliedGoals(mk), e = o.entry, u = o.ouEntry;
    all.push({ date: r.date, code: c, league: ALL_LEAGUES[c], home: r.HomeTeam, away: r.AwayTeam, gh, ga, hth: r.HTHG === "" || r.HTHG === undefined ? null : +r.HTHG, hta: r.HTAG === "" || r.HTAG === undefined ? null : +r.HTAG, goals, f: rec.feats, fh, fa, formH: rec.formH, formA: rec.formA, h2h: rec.h2h, mk, grid: marketProbs(goals[0], goals[1]), mgrid: marketProbs(ig[0], ig[1]), real: { MS1: e?.[0], MSX: e?.[1], MS2: e?.[2], "1X": dcOdd(e, 0, 1), X2: dcOdd(e, 1, 2), 12: dcOdd(e, 0, 2), U25: u?.[0], A25: u?.[1] }, ox: oddsOf(r), mx: [num(r["Max>2.5"]), num(r["Max<2.5"])] });
  }
}
all.sort((a, b) => a.date.localeCompare(b.date));
const std = standardize(all.filter(d => d.date < start).map(d => d.f));
for (const d of all) d.z = d.f.map((v, i) => Math.max(-4, Math.min(4, (v - std.mean[i]) / std.sd[i])));
const calFrom = rows => Object.fromEntries(MARKETS.map(m => [m.key, fitCal(rows.slice(-20000).flatMap(d => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); return y === null ? [] : [[d.grid[m.key], y]]; }), 120)]));
const cands = (d, cal) => MARKETS.flatMap(m => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); if (y === null) return []; const real = d.real[m.key] ?? null, pm = d.mgrid[m.key], p = applyCal(d.grid[m.key], cal[m.key]), est = estOdds(pm, m.key), odd = real ?? est; if (odd < MIN || p < .45) return []; return [{ key: m.key, label: m.label, p, pm, real, est, odd, y }]; });
const fit = (rows, cal) => { const tr = rows.slice(-25000).flatMap(d => cands(d, cal).map(c => ({ x: metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), y: c.y ? 1 : 0, off: null }))); const w = fitLogit(tr, META_DIM, { classes: 2, iters: 90, lr: .3 }), pairs = []; for (let i = 0; i < tr.length; i += 7) pairs.push([score(tr[i].x, w)[1], tr[i].y]); return { w, c: fitCal(pairs, 120) }; };

// ---- Sinav ----
const low = (a, b) => a && b ? a.map((v, i) => Number.isFinite(v) && Number.isFinite(b[i]) ? Math.min(v, b[i]) : v) : a;
const dict = (x, ou) => ({ MS1: x?.[0], MSX: x?.[1], MS2: x?.[2], "1X": dcOdd(x, 0, 1), X2: dcOdd(x, 1, 2), 12: dcOdd(x, 0, 2), U25: ou?.[0], A25: ou?.[1] });
const closeP = d => { const p = d.ox.close && devig(d.ox.close), q = d.ox.ouClose && devig(d.ox.ouClose); return { MS1: p?.[0], MSX: p?.[1], MS2: p?.[2], "1X": p && p[0] + p[1], X2: p && p[1] + p[2], 12: p && p[0] + p[2], U25: q?.[0], A25: q?.[1] }; };
const year = s => s.slice(0, 4), quarters = []; for (let t = Date.parse(start); t < now; t += 91 * 864e5) quarters.push(day(t));
const A = [], B = [], Cday = new Map(), acc = [];
for (const [i, q] of quarters.entries()) {
  const nx = quarters[i + 1] || day(now + 864e5), pre = all.filter(d => d.date < q), cur = all.filter(d => d.date >= q && d.date < nx); if (pre.length < 3000 || !cur.length) continue;
  const cal = calFrom(pre), m = fit(pre, cal);
  for (const d of cur) {
    const L = dict(low(d.ox.entry, d.ox.avg), low(d.ox.ouEntry, d.ox.ouAvg)), b365 = dict(d.ox.entry, d.ox.ouEntry), cp = closeP(d);
    // Motorun mac sonucu tahmini ve piyasanin favorisi
    const res = d.gh > d.ga ? 0 : d.gh === d.ga ? 1 : 2, pr = [applyCal(d.grid.MS1, cal.MS1), applyCal(d.grid.MSX, cal.MSX), applyCal(d.grid.MS2, cal.MS2)];
    acc.push({ y: year(d.date), eng: pr.indexOf(Math.max(...pr)) === res, mkt: d.mk.indexOf(Math.max(...d.mk)) === res });
    // A: En guvendigim (gercek dusuk oran >= 1,30, mp >= 0,72)
    const opts = cands(d, cal).filter(c => L[c.key] >= 1.3).map(c => ({ ...c, mp: applyCal(score(metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), m.w)[1], m.c), o: L[c.key], b: b365[c.key] })).sort((a, b) => b.mp - a.mp);
    if (opts[0] && opts[0].mp >= 0.72) { const x = opts[0]; A.push({ date: d.date, code: d.code, label: x.label, y: x.y, o: x.o, b: x.b, mp: x.mp, clv: cp[x.key] && x.b ? x.b * cp[x.key] - 1 : null }); }
    // Kupon ayaklari
    if (opts[0]) (Cday.get(d.date) || Cday.set(d.date, []).get(d.date)).push(...opts.slice(0, 4).map(x => ({ id: d.home + d.away, mp: x.mp, o: x.o, y: x.y })));
    // B: Motorun secimleri (fiyat disiplini): en yuksek oranin %98'i adil fiyatin ustunde, 1,30-3,20
    const fair = devig(d.ox.fair), ouf = d.ox.ouFair && devig(d.ox.ouFair), cand = [];
    if (fair) fair.forEach((p, k) => cand.push({ key: ["MS1", "MSX", "MS2"][k], label: ["MS 1", "MS X", "MS 2"][k], p, mx: d.ox.max?.[k], b: d.ox.entry?.[k], y: res === k }));
    if (ouf) ouf.forEach((p, k) => cand.push({ key: ["U25", "A25"][k], label: ["2,5 Üst", "2,5 Alt"][k], p, mx: d.mx[k], b: d.ox.ouEntry?.[k], y: (d.gh + d.ga > 2.5) === !k }));
    let top = null; for (const x of cand) { if (!Number.isFinite(x.mx) || x.mx < 1.3) continue; const price = x.mx * 0.98; if (price < 1.3 || price > 3.2) continue; const ev = x.p * price - 1; if (ev >= 0 && (!top || ev > top.ev)) top = { ...x, ev, min: Math.max(1.3, 1 / x.p / 0.98) }; }
    if (top) B.push({ date: d.date, code: d.code, label: top.label, y: top.y, mx: top.mx, b: top.b, min: top.min, bok: Number.isFinite(top.b) && top.b >= top.min, clv: cp[top.key] && top.b ? top.b * cp[top.key] - 1 : null });
  }
}
// C: gunluk kupon (2'yi gecen, en fazla 3 ayak, tutma ihtimali >= 0,40)
const C = [];
for (const [dt, legs0] of Cday) { const pool = legs0.sort((a, b) => b.mp - a.mp).slice(0, 30), used = new Set();
  for (let n = 0; n < 3; n++) { const P = pool.filter(x => !used.has(x.id)); let best = null; const t = l => { if (new Set(l.map(x => x.id)).size < l.length) return; const o = l.reduce((a, x) => a * x.o, 1); if (o < 2) return; const p = l.reduce((a, x) => a * x.mp, 1); if (!best || p > best.p) best = { l, o, p }; };
    for (let i = 0; i < P.length; i++) { t([P[i]]); for (let j = i + 1; j < P.length; j++) { t([P[i], P[j]]); for (let k = j + 1; k < P.length; k++) t([P[i], P[j], P[k]]); } }
    if (!best || best.p < 0.4) break; best.l.forEach(x => used.add(x.id)); C.push({ date: dt, y: best.l.every(x => x.y), o: best.o }); } }
const st = (l, odd) => { l = l.filter(x => Number.isFinite(odd(x)) && odd(x) > 1); if (!l.length) return { seçim: 0 }; const v = l.map(x => x.y ? odd(x) - 1 : -1), pr = v.reduce((a, b) => a + b, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((a, b) => a + (b - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.y).length, ortalamaOran: +(l.reduce((a, x) => a + odd(x), 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const clv = l => { const c = l.filter(x => Number.isFinite(x.clv)); return c.length ? +(c.reduce((a, x) => a + x.clv, 0) / c.length * 100).toFixed(1) : null; };
const byYear = (l, f) => Object.fromEntries(Object.entries(Object.groupBy(l, x => year(x.date))).sort().map(([y, v]) => [y, f(v)]));
const byLabel = (l, odd) => Object.entries(Object.groupBy(l, x => x.label)).map(([k, v]) => ({ pazar: k, ...st(v, odd) })).sort((a, b) => b.seçim - a.seçim);
const byLeague = (l, odd) => Object.entries(Object.groupBy(l, x => x.code)).map(([k, v]) => ({ lig: ALL_LEAGUES[k], ...st(v, odd) })).filter(x => x.seçim >= 40).sort((a, b) => b.getiri100 - a.getiri100);
const out = { generatedAt: new Date().toISOString(), başlangıç: start, maç: acc.length,
  isabet: byYear(acc.map(x => ({ ...x, date: x.y })), v => ({ maç: v.length, motor: v.filter(x => x.eng).length, piyasa: v.filter(x => x.mkt).length })),
  enGüvendiğim: { gerçekOran: st(A, x => x.o), bet365: st(A, x => x.b), kapanış100_bet365: clv(A), yıl: byYear(A, v => st(v, x => x.b)), pazar: byLabel(A, x => x.b) },
  motorunSeçimleri: { enYüksekOran: st(B, x => x.mx), bet365: st(B, x => x.b), bet365SınırıGeçen: st(B.filter(x => x.bok), x => x.b), kapanış100_bet365: clv(B), yıl: byYear(B, v => ({ enYüksek: st(v, x => x.mx), bet365: st(v, x => x.b), bet365Geçen: st(v.filter(x => x.bok), x => x.b) })), pazar: byLabel(B, x => x.mx), lig: byLeague(B, x => x.mx) },
  kupon: { hepsi: st(C, x => x.o), yıl: byYear(C, v => st(v, x => x.o)) } };
fs.writeFileSync("docs/test3.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, motorunSeçimleri: { ...out.motorunSeçimleri, lig: out.motorunSeçimleri.lig.slice(0, 5).concat(out.motorunSeçimleri.lig.slice(-5)) } }));
