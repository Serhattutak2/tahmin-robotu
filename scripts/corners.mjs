// Korner ve kart modeli: takimlarin yakin gecmis korner/kart ortalamalari (ustel agirlikli) ve lig ortalamasi.
// Cizgi olasiliklari (ornek: korner 9,5 ust) secim doneminde ayarlanir, sinav doneminde (2024/25-bugun) isabet olculur.
// Not: bu pazarlarin eski oranlari kaynakta yok; kar test edilemez, yalnizca tahmin isabeti olculur.
import fs from "node:fs";
import { fdDate } from "../lib/engine.mjs";
const num = v => v === "" || v === undefined || v === null ? NaN : Number(v);
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const codes = Object.keys(FD_LEAGUES), seasons = FD_SEASONS.filter(s => s >= "2122"), A = 0.12, LA = 0.02;
const files = await mapLimit(seasons.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const games = [];
for (const f of files) if (f?.rows) for (const r of f.rows) { const date = fdDate(r.Date), v = ["HC", "AC", "HY", "AY", "HR", "AR"].map(k => num(r[k])); if (!date || !r.HomeTeam || v.some(x => !Number.isFinite(x))) continue; games.push({ date, code: f.c, home: r.HomeTeam, away: r.AwayTeam, hc: v[0], ac: v[1], hk: v[2] + v[4], ak: v[3] + v[5] }); }
games.sort((a, b) => a.date.localeCompare(b.date));
const teams = new Map(), lg = new Map(), T = (c, t) => { const k = c + "|" + t; if (!teams.has(k)) teams.set(k, { cf: null, ca: null, kf: null, ka: null, n: 0 }); return teams.get(k); };
const L = c => { if (!lg.has(c)) lg.set(c, { hc: 5.3, ac: 4.4, hk: 1.9, ak: 2.1 }); return lg.get(c); };
const ew = (o, k, v, a) => { o[k] = o[k] === null || o[k] === undefined ? v : o[k] * (1 - a) + v * a; };
export function predict(l, h, a) {
  const tc = (l.hc + l.ac) / 2, tk = (l.hk + l.ak) / 2;
  const mc = l.hc * (h.cf / tc) * (a.ca / tc) + l.ac * (a.cf / tc) * (h.ca / tc), mk = l.hk * (h.kf / tk) * (a.ka / tk) + l.ak * (a.kf / tk) * (h.ka / tk);
  return { mc, mk };
}
const rows = [];
for (const gm of games) {
  const l = L(gm.code), h = T(gm.code, gm.home), a = T(gm.code, gm.away);
  if (h.n >= 6 && a.n >= 6) { const p = predict(l, h, a); rows.push({ date: gm.date, code: gm.code, mc: p.mc, mk: p.mk, tc: gm.hc + gm.ac, tk: gm.hk + gm.ak }); }
  ew(h, "cf", gm.hc, A); ew(h, "ca", gm.ac, A); ew(a, "cf", gm.ac, A); ew(a, "ca", gm.hc, A);
  ew(h, "kf", gm.hk, A); ew(h, "ka", gm.ak, A); ew(a, "kf", gm.ak, A); ew(a, "ka", gm.hk, A); h.n++; a.n++;
  ew(l, "hc", gm.hc, LA); ew(l, "ac", gm.ac, LA); ew(l, "hk", gm.hk, LA); ew(l, "ak", gm.ak, LA);
}
const LINES = { korner: [7.5, 8.5, 9.5, 10.5, 11.5], kart: [2.5, 3.5, 4.5, 5.5] }, cut = "2024-07-01", sel = rows.filter(r => r.date < cut), test = rows.filter(r => r.date >= cut);
const sig = z => 1 / (1 + Math.exp(-z));
const fitLine = (data, mu, y) => { let a = 0, b = 1; for (let it = 0; it < 400; it++) { let ga = 0, gb = 0; for (const d of data) { const x = Math.log(mu(d)), e = sig(a + b * x) - y(d); ga += e; gb += e * x; } a -= 0.5 * ga / data.length; b -= 0.5 * gb / data.length; } return [a, b]; };
const cal = {}, report = { generatedAt: new Date().toISOString(), ayrım: cut, maç: rows.length, sınavMaç: test.length, korner: {}, kart: {} };
for (const [kind, lines] of Object.entries(LINES)) for (const line of lines) {
  const mu = kind === "korner" ? d => d.mc : d => d.mk, tot = kind === "korner" ? d => d.tc : d => d.tk, y = d => tot(d) > line ? 1 : 0;
  const [a, b] = fitLine(sel, mu, y), base = sel.reduce((s, d) => s + y(d), 0) / sel.length, P = d => sig(a + b * Math.log(mu(d)));
  const brier = test.reduce((s, d) => s + (P(d) - y(d)) ** 2, 0) / test.length, brierBase = test.reduce((s, d) => s + (base - y(d)) ** 2, 0) / test.length;
  // Motorun emin oldugu taraf: olasilik >= 0,62 olan taraf (ust ya da alt). Tuttu mu?
  const conf = test.map(d => { const p = P(d); return p >= 0.62 ? { p, y: y(d) } : p <= 0.38 ? { p: 1 - p, y: 1 - y(d) } : null; }).filter(Boolean);
  cal[`${kind}${line}`] = [a, b];
  report[kind][line] = { üstOranıGerçek: +(test.reduce((s, d) => s + y(d), 0) / test.length).toFixed(3), beceri: +(1 - brier / brierBase).toFixed(4), eminSeçim: conf.length, eminTutan: conf.filter(x => x.y).length, eminBeklenen: Math.round(conf.reduce((s, x) => s + x.p, 0)) };
}
fs.writeFileSync("docs/corners.json", JSON.stringify(report, null, 1));
// Canli kullanim icin guncel durum
const state = { generatedAt: report.generatedAt, cal, leagues: Object.fromEntries(lg), teams: Object.fromEntries([...teams].filter(([, v]) => v.n >= 6).map(([k, v]) => [k, { cf: +v.cf.toFixed(3), ca: +v.ca.toFixed(3), kf: +v.kf.toFixed(3), ka: +v.ka.toFixed(3), n: v.n }])) };
fs.writeFileSync("config/corners.json", JSON.stringify(state));
console.log(JSON.stringify(report));
