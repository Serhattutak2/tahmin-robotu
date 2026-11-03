// Bes yillik ileri dogru oyun. Her ceyrek: gecmisle ogren, tahmin et, sonucu gor, ders cikar, sonraki ceyrege gec.
import fs from "node:fs";
import { devig, fdDate } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { fitLogit, score, standardize } from "../lib/features.mjs";
import { MARKETS, marketProbs, impliedGoals, fitCal, applyCal, outcome } from "../lib/markets.mjs";
import { metaX, META_DIM, estOdds } from "../lib/meta.mjs";
import { FD_SEASONS, ALL_LEAGUES, EXTRA_LEAGUES, fdSeason, extraRows, mapLimit } from "../lib/sources.mjs";
const now = process.env.REVIEW_NOW ? Date.parse(process.env.REVIEW_NOW) : Date.now(), day = t => new Date(t).toISOString().slice(0, 10), MIN = 1.2, start = day(now - 5 * 365.25 * 864e5), maxQ = Number(process.env.WF_QUARTERS || 99);
const fdCodes = Object.keys(ALL_LEAGUES).filter(c => !(c in EXTRA_LEAGUES));
const files = await mapLimit(FD_SEASONS.flatMap(s => fdCodes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) })), extras = await mapLimit(Object.keys(EXTRA_LEAGUES), 4, async c => ({ c, rows: await extraRows(c) }));
const dcOdd = (o, a, b) => o?.[a] > 1 && o?.[b] > 1 ? +(1 / (1 / o[a] + 1 / o[b])).toFixed(2) : null, all = [];
for (const c of Object.keys(ALL_LEAGUES)) {
  const src = c in EXTRA_LEAGUES ? (extras.find(x => x?.c === c)?.rows || []).map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => r.date >= "2017-07-01").sort((a, b) => a.date.localeCompare(b.date)) : files.filter(f => f?.rows && f.c === c).sort((a, b) => a.s.localeCompare(b.s)).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, date: fdDate(r.Date) })));
  for (const rec of walkLeague(src.filter(r => r.date && r.HomeTeam && r.FTHG !== "" && Number.isFinite(+r.FTHG)))) {
    if (rec.games < 10 || !rec.dc) continue; const o = oddsOf(rec.r); if (!o.fair) continue; const mk = devig(o.fair); if (!mk) continue;
    const r = rec.r, l = k => rec.dx ? (rec.dx[k] + rec.dc[k]) / 2 : rec.dc[k], goals = [l("lh"), l("la")], ig = impliedGoals(mk), e = o.entry, u = o.ouEntry;
    all.push({ date: r.date, code: c, league: ALL_LEAGUES[c], gh: +r.FTHG, ga: +r.FTAG, hth: r.HTHG === "" || r.HTHG === undefined ? null : +r.HTHG, hta: r.HTAG === "" || r.HTAG === undefined ? null : +r.HTAG, goals, f: rec.feats, grid: marketProbs(goals[0], goals[1]), mgrid: marketProbs(ig[0], ig[1]), real: { MS1: e?.[0], MSX: e?.[1], MS2: e?.[2], "1X": dcOdd(e, 0, 1), X2: dcOdd(e, 1, 2), 12: dcOdd(e, 0, 2), U25: u?.[0], A25: u?.[1] } });
  }
}
all.sort((a, b) => a.date.localeCompare(b.date));
const std = standardize(all.filter(d => d.date < start).map(d => d.f));
for (const d of all) d.z = d.f.map((v, i) => Math.max(-4, Math.min(4, (v - std.mean[i]) / std.sd[i])));
const calFrom = rows => Object.fromEntries(MARKETS.map(m => [m.key, fitCal(rows.slice(-20000).flatMap(d => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); return y === null ? [] : [[d.grid[m.key], y]]; }), 120)]));
function cands(d, cal, realOnly = false) { return MARKETS.flatMap(m => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); if (y === null) return []; const real = d.real[m.key] ?? null; if (realOnly && real === null) return []; const pm = d.mgrid[m.key], p = applyCal(d.grid[m.key], cal[m.key]), est = estOdds(pm, m.key), odd = real ?? est; if (odd < MIN || p < 0.3) return []; return [{ key: m.key, label: m.label, p, pm, real, est, odd, y }]; }); }
const fitModel = (rows, cal) => { const recent = rows.slice(-25000), tr = recent.flatMap(d => cands(d, cal).filter(c => c.p >= .45).map(c => ({ x: metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), y: c.y ? 1 : 0, off: null }))); const w = fitLogit(tr, META_DIM, { classes: 2, iters: 90, lr: 0.3 }); const pairs = []; for (let i = 0; i < tr.length; i += 7) pairs.push([score(tr[i].x, w)[1], tr[i].y]); return { w, c: fitCal(pairs, 120) }; };
// Ileri test: ceyrek basina tek egitim.
const quarters = []; for (let t = Date.parse(start); t < now; t += 91 * 864e5) quarters.push(day(t));
const oos = [], log = []; let lessons = {};
const sum = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + (x.y ? x.odd - 1 : -1), 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + ((x.y ? x.odd - 1 : -1) - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.y).length, ortalamaOran: +(l.reduce((a, x) => a + x.odd, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri: +roi.toFixed(4), alt: +(roi - 1.96 * se).toFixed(3), üst: +(roi + 1.96 * se).toFixed(3) }; };
const RULES = { "Kâr, tüm pazarlar": { real: false, by: "ev" }, "Kâr, yalnız gerçek oranlı": { real: true, by: "ev" }, "%80, tüm pazarlar": { real: false, by: "mp" }, "%80, yalnız gerçek oranlı": { real: true, by: "mp" } };
const picks = Object.fromEntries(Object.keys(RULES).map(k => [k, []]));
const thresholds = rule => rule.by === "ev" ? [.01, .02, .03, .05, .07, .1] : [.7, .72, .74, .76, .78, .8, .82, .85];
for (const [qi, q] of quarters.slice(0, maxQ).entries()) {
  const next = quarters[qi + 1] || day(now + 864e5), pre = all.filter(d => d.date < q), cur = all.filter(d => d.date >= q && d.date < next); if (pre.length < Number(process.env.WF_MINPRE || 3000) || !cur.length) continue;
  const cal = calFrom(pre), m = fitModel(pre, cal), entry = { çeyrek: q, maç: cur.length, kural: {} };
  for (const [name, rule] of Object.entries(RULES)) {
    const hist = oos.filter(x => x.rule === name), banned = new Set();
    // Ders: gecmiste guclu zarar eden pazar kapanir. Kazanan pazar kendi oraninda kalir.
    const byKey = Object.groupBy(hist.filter(x => x.y !== undefined), x => x.key); for (const [k, v] of Object.entries(byKey)) { const s = sum(v); if (s.seçim >= 80 && s.üst < 0) banned.add(k); }
    let T = rule.by === "ev" ? .05 : .76;
    if (hist.length >= 400) { const ranked = thresholds(rule).map(t => ({ t, s: sum(hist.filter(x => x[rule.by] >= t && !banned.has(x.key))) })).filter(x => x.s.seçim >= 80); if (rule.by === "ev") T = ranked.sort((a, b) => b.s.getiri - a.s.getiri)[0]?.t ?? T; else T = ranked.filter(x => x.s.tutan / x.s.seçim >= .8).sort((a, b) => a.t - b.t)[0]?.t ?? T; }
    entry.kural[name] = { eşik: T, kapananPazar: [...banned] };
    for (const d of cur) { const l = cands(d, cal, rule.real).map(c => { const mp = applyCal(score(metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), m.w)[1], m.c); return { ...c, mp, ev: mp * c.odd - 1 }; }).filter(c => !banned.has(c.key)).sort((a, b) => b[rule.by] - a[rule.by]); const top = l[0]; if (!top) continue; const row = { rule: name, key: top.key, label: top.label, real: top.real, odd: top.odd, ev: top.ev, mp: top.mp, y: top.y, date: d.date, league: d.league }; oos.push(row); if (row[rule.by] >= T) picks[name].push(row); }
  }
  log.push(entry); console.log(q, cur.length, Object.entries(picks).map(([k, v]) => `${k}:${v.length}`).join(" "));
}
const yr = l => Object.fromEntries(Object.entries(Object.groupBy(l, x => x.date.slice(0, 4))).map(([k, v]) => [k, sum(v)]));
const realOnly = l => l.filter(x => x.real !== null);
const out = Object.fromEntries(Object.entries(picks).map(([k, l]) => { const r = realOnly(l), g = (f, o = 8) => Object.entries(Object.groupBy(l, f)).map(([a, v]) => [a, sum(v)]).filter(x => x[1].seçim >= 20).sort((a, b) => b[1].kar - a[1].kar); const m = g(x => x.label), lgs = g(x => x.league); return [k, { hepsi: sum(l), gerçekOranlı: sum(r), yıllar: yr(r), enİyiPazar: m.slice(0, 6), enKötüPazar: m.slice(-6), enİyiLig: lgs.slice(0, 5), enKötüLig: lgs.slice(-5) }]; }));
const proven = k => { const s = out[k].gerçekOranlı; return s.seçim >= 300 && s.alt > 0; }, finalRule = Object.keys(picks).filter(proven).sort((a, b) => out[b].gerçekOranlı.getiri - out[a].gerçekOranlı.getiri)[0] || null;
const report = { generatedAt: new Date(now).toISOString(), başlangıç: start, çeyrek: log.length, toplamMaç: all.length, kurallar: out, karar: { kazanan: finalRule, kanıtlı: !!finalRule }, kayıt: log.slice(-4) };
fs.writeFileSync("docs/walk5.json", JSON.stringify(report, null, 1));
fs.writeFileSync("config/final.json", JSON.stringify({ generatedAt: report.generatedAt, rule: finalRule, proven: !!finalRule }, null, 1));
console.log(JSON.stringify({ karar: report.karar, kurallar: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { h: v.hepsi, g: v.gerçekOranlı, y: v.yıllar }])) }));
