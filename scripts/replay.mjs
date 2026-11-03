// Hafta hafta tekrar oynatma. Her mac: o tarihe kadarki 5 yillik takim verisi, tahmin, sonra sonuc.
// Motor agirliklari ceyrekte bir, yalniz o tarihten onceki maclarla yenilenir.
import fs from "node:fs";
import { devig, fdDate } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { fitLogit, score, standardize } from "../lib/features.mjs";
import { MARKETS, marketProbs, impliedGoals, fitCal, applyCal, outcome } from "../lib/markets.mjs";
import { metaX, META_DIM, estOdds } from "../lib/meta.mjs";
import { FD_SEASONS, ALL_LEAGUES, EXTRA_LEAGUES, fdSeason, extraRows, mapLimit } from "../lib/sources.mjs";
const now = process.env.REVIEW_NOW ? Date.parse(process.env.REVIEW_NOW) : Date.now(), day = t => new Date(t).toISOString().slice(0, 10), start = day(now - 2 * 365.25 * 864e5), MIN = 1.2, FIVE = 5 * 365.25 * 864e5;
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
    all.push({ date: r.date, code: c, league: ALL_LEAGUES[c], home: r.HomeTeam, away: r.AwayTeam, gh, ga, hth: r.HTHG === "" || r.HTHG === undefined ? null : +r.HTHG, hta: r.HTAG === "" || r.HTAG === undefined ? null : +r.HTAG, goals, f: rec.feats, fh, fa, formH: rec.formH, formA: rec.formA, h2h: rec.h2h, mk, grid: marketProbs(goals[0], goals[1]), mgrid: marketProbs(ig[0], ig[1]), real: { MS1: e?.[0], MSX: e?.[1], MS2: e?.[2], "1X": dcOdd(e, 0, 1), X2: dcOdd(e, 1, 2), 12: dcOdd(e, 0, 2), U25: u?.[0], A25: u?.[1] } });
  }
}
all.sort((a, b) => a.date.localeCompare(b.date));
const std = standardize(all.filter(d => d.date < start).map(d => d.f));
for (const d of all) d.z = d.f.map((v, i) => Math.max(-4, Math.min(4, (v - std.mean[i]) / std.sd[i])));
const calFrom = rows => Object.fromEntries(MARKETS.map(m => [m.key, fitCal(rows.slice(-20000).flatMap(d => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); return y === null ? [] : [[d.grid[m.key], y]]; }), 120)]));
const cands = (d, cal) => MARKETS.flatMap(m => { const y = outcome(m, d.gh, d.ga, d.hth, d.hta); if (y === null) return []; const real = d.real[m.key] ?? null, pm = d.mgrid[m.key], p = applyCal(d.grid[m.key], cal[m.key]), est = estOdds(pm, m.key), odd = real ?? est; if (odd < MIN || p < .45) return []; return [{ key: m.key, label: m.label, p, pm, real, est, odd, y }]; });
const fit = (rows, cal) => { const tr = rows.slice(-25000).flatMap(d => cands(d, cal).map(c => ({ x: metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), y: c.y ? 1 : 0, off: null }))); const w = fitLogit(tr, META_DIM, { classes: 2, iters: 90, lr: .3 }), pairs = []; for (let i = 0; i < tr.length; i += 7) pairs.push([score(tr[i].x, w)[1], tr[i].y]); return { w, c: fitCal(pairs, 120) }; };
const quarters = []; for (let t = Date.parse(start); t < now; t += 91 * 864e5) quarters.push(day(t));
const played = [], bets = [];
for (const [i, q] of quarters.entries()) {
  const nx = quarters[i + 1] || day(now + 864e5), pre = all.filter(d => d.date < q), cur = all.filter(d => d.date >= q && d.date < nx); if (pre.length < Number(process.env.WF_MINPRE || 3000) || !cur.length) continue;
  const cal = calFrom(pre), m = fit(pre, cal);
  for (const d of cur) {
    const opts = cands(d, cal).map(c => ({ ...c, mp: applyCal(score(metaX(c.key, c.p, c.pm, d.goals, d.code, d.z), m.w)[1], m.c) })).sort((a, b) => b.mp - a.mp), top = opts[0], ms = [d.mk.indexOf(Math.max(...d.mk))][0], pr = [applyCal(d.grid.MS1, cal.MS1), applyCal(d.grid.MSX, cal.MSX), applyCal(d.grid.MS2, cal.MS2)], side = pr.indexOf(Math.max(...pr)), res = d.gh > d.ga ? 0 : d.gh === d.ga ? 1 : 2, ls = likelyScore(d.goals[0], d.goals[1]);
    played.push({ t: d.date, l: d.league, h: d.home, a: d.away, s: `${d.gh}-${d.ga}`, ls: `${ls[0]}-${ls[1]}`, lsOk: ls[0] === d.gh && ls[1] === d.ga, eg: d.goals.map(v => +v.toFixed(2)), ms: ["1", "X", "2"][side], msOk: side === res, pmOk: ms === res, fh: d.fh, fa: d.fa, fH: d.formH, fA: d.formA, h2: d.h2h, p: top ? { label: top.label, odd: top.odd, real: top.real !== null, ok: !!top.y, g: top.mp >= .76 } : null, ou: d.grid.U25 >= .5 ? "2,5 Üst" : "2,5 Alt", ouOk: (d.grid.U25 >= .5) === (d.gh + d.ga > 2.5) });
    for (const c of opts) if (c.real !== null) bets.push({ date: d.date, key: c.key, label: c.label, odd: c.real, y: c.y, mp: c.mp });
    if (top && top.real === null) bets.push({ date: d.date, key: top.key, label: top.label, odd: top.est, y: top.y, mp: top.mp, est: true });
  }
}
const stat = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + (x.y ? x.odd - 1 : -1), 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + ((x.y ? x.odd - 1 : -1) - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.y).length, ortalamaOran: +(l.reduce((a, x) => a + x.odd, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
// Oran bandi: motorun maç başına gerçek oranlı en güvendiği seçeneği.
const realBets = bets.filter(b => !b.est), BANDS = [[1.2, 1.35], [1.35, 1.5], [1.5, 1.75], [1.75, 2.1], [2.1, 2.6], [2.6, 3.5], [3.5, 6], [6, 99]];
const bandTable = BANDS.map(([a, z]) => { const l = realBets.filter(b => b.odd >= a && b.odd < z), conf = l.filter(b => b.mp * b.odd - 1 >= 0.02); return { bant: `${a}-${z}`, hepsi: stat(l), motorDeğerGördü: stat(conf) }; });
const marketTable = Object.entries(Object.groupBy(realBets, b => b.label)).map(([k, v]) => ({ pazar: k, ...stat(v) })).sort((a, b) => b.kar - a.kar);
const weeks = Object.groupBy(played, x => { const d = new Date(x.t + "T00:00:00Z"), w = new Date(d - ((d.getUTCDay() + 6) % 7) * 864e5); return w.toISOString().slice(0, 10); });
fs.rmSync("docs/replay", { recursive: true, force: true }); fs.mkdirSync("docs/replay", { recursive: true });
const weekIndex = Object.entries(weeks).sort().map(([w, l]) => { fs.writeFileSync(`docs/replay/${w}.json`, JSON.stringify(l)); const sel = l.filter(x => x.p?.g); return { hafta: w, maç: l.length, ms: l.filter(x => x.msOk).length, piyasaMs: l.filter(x => x.pmOk).length, skor: l.filter(x => x.lsOk).length, üstAlt: l.filter(x => x.ouOk).length, seçim: sel.length, seçimTutan: sel.filter(x => x.p.ok).length }; });
const cnt = (f, g) => played.filter(f).filter(g).length, gg = played.filter(x => x.p?.g);
const report = { generatedAt: new Date(now).toISOString(), başlangıç: start, toplam: { maç: played.length, maçSonucu: played.filter(x => x.msOk).length, piyasaMaçSonucu: played.filter(x => x.pmOk).length, skor: played.filter(x => x.lsOk).length, üstAlt: played.filter(x => x.ouOk).length, güvenliSeçim: gg.length, güvenliTutan: gg.filter(x => x.p.ok).length, güvenliGerçekOranlı: stat(gg.filter(x => x.p.real).map(x => ({ odd: x.p.odd, y: x.p.ok }))) }, oranBandı: bandTable, pazar: marketTable, haftalar: weekIndex };
fs.writeFileSync("docs/replay-index.json", JSON.stringify(report));
console.log(JSON.stringify({ ...report, haftalar: weekIndex.length }));
