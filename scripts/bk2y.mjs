// Basketbol robotu, son iki sezon ogren-sina dongusu (acilis cizgileri, 2022-23'ten Ocak 2026'ya; kyleskom OddsData arsivi).
// 1. tur: ogren 2022-23 + 2023-24, sina 2024-25. 2. tur: ogren 2022-23..2024-25, sina 2025-26. Ayar yalniz ogrenme doneminde secilir.
import fs from "node:fs";
import { BModel, bOver } from "../lib/basket2.mjs";
const RAW = JSON.parse(fs.readFileSync(process.env.NBA2226, "utf8"));
const nick = n => { const w = String(n).trim().split(/\s+/).at(-1).toLowerCase(); return w === "bobcats" ? "hornets" : w; };
const G = RAW.map(g => ({ ...g, h: nick(g.h), a: nick(g.a), as: g.as_ })).filter(g => g.hs + g.as > 150 && g.ou > 170).sort((a, b) => a.day.localeCompare(b.day));
// Her mac icin ozellikler (yalniz o mactan oncekiler): model tahmini (iki gecis ayari), takimlarin cizgiye gore sapma egilimi, dinlenme.
function features(carry, lr = 0.2, ra_ = 0.1) {
  const M = new BModel({ lr, home: 2, mean: 112, carry }), R = {}, rows = []; let season = null; const sg = [];
  for (const g of G) {
    if (g.season !== season) { season = g.season; M.newSeason(season); sg.length = 0; }
    if (sg.length >= 20) M.mean = sg.reduce((s, x) => s + x.hs + x.as, 0) / sg.length / 2;
    const p = M.predict(g.h, g.a, g.day), rh = R[g.h] ?? 0, ra = R[g.a] ?? 0, tot = g.hs + g.as;
    if (p.games >= 10 && tot !== g.ou) { const q = bOver(p, g.ou); rows.push({ season: g.season, day: g.day, q, z: (p.total - g.ou) / p.sdT, bias: (rh + ra) / 2, rest: Math.min(g.rh, 4) + Math.min(g.ra, 4), b2b: (g.rh <= 1 ? 1 : 0) + (g.ra <= 1 ? 1 : 0), lvl: g.ou - (sg.length ? sg.reduce((s, x) => s + x.hs + x.as, 0) / sg.length : g.ou), y: tot > g.ou }); }
    M.update(g.h, g.a, g.hs, g.as, g.day); sg.push(g);
    const res = tot - g.ou; for (const t of [g.h, g.a]) R[t] = (R[t] ?? 0) * (1 - ra_) + res * ra_;
  }
  return rows;
}
const st = l => { if (!l.length) return { seçim: 0 }; const v = l.map(b => b.win ? .91 : -1), pr = v.reduce((a, b) => a + b, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((a, b) => a + (b - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(b => b.win).length, kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const betOn = (rows, pf, t) => rows.map(r => { const p = pf(r), c = Math.max(p, 1 - p); return c >= t ? { win: (p >= .5) === r.y } : null; }).filter(Boolean);
// Kucuk lojistik model (ders katmani): z, takim sapma egilimi, dinlenme, cizgi seviyesi.
const X = r => [1, r.z, r.bias / 10, r.rest / 8, r.b2b, r.lvl / 10];
function fitLog(rows) { let w = new Array(6).fill(0); for (let it = 0; it < 1500; it++) { const g = new Array(6).fill(0); for (const r of rows) { const x = X(r), p = 1 / (1 + Math.exp(-x.reduce((s, v, i) => s + v * w[i], 0))), e = p - (r.y ? 1 : 0); x.forEach((v, i) => g[i] += e * v); } w = w.map((v, i) => v - 0.5 * (g[i] / rows.length + 0.001 * v * (i > 0))); } return w; }
const plog = w => r => 1 / (1 + Math.exp(-X(r).reduce((s, v, i) => s + v * w[i], 0)));
const TH = [0.52, 0.53, 0.54, 0.55, 0.56, 0.58, 0.6, 0.62, 0.65, 0.68, 0.7, 0.72, 0.75];
function round(learnS, testS, carry) {
  const res = {}, best = {};
  for (const lr of [0.03, 0.06, 0.1, 0.2]) for (const ra_ of [0.05, 0.1, 0.2]) {
    const rows = features(carry, lr, ra_), L = rows.filter(r => learnS.includes(r.season)), T = rows.filter(r => r.season === testS), w = fitLog(L);
    const cands = { "Robot (temel)": r => r.q, "Robot ters yön (ders 1)": r => 1 - r.q, "Takım sapma eğilimi (ders 2)": r => 1 / (1 + Math.exp(-r.bias / 4)), "Robot + ders katmanı (lojistik)": plog(w) };
    for (const [name, pf] of Object.entries(cands)) { const g = TH.map(t => ({ t, l: st(betOn(L, pf, t)) })).filter(x => x.l.seçim >= 150).sort((a, b) => b.l.getiri100 - a.l.getiri100)[0];
      if (g && (!best[name] || g.l.getiri100 > best[name].öğrenme.getiri100)) best[name] = { ayar: { lr, sapmaHızı: ra_, eşik: g.t }, öğrenme: g.l, sınav: st(betOn(T, pf, g.t)), ağırlık: name.includes("lojistik") ? w.map(v => +v.toFixed(3)) : undefined }; }
  }
  return { öğren: learnS, sına: testS, geçiş: carry, sonuç: best };
}
const out = { generatedAt: new Date().toISOString(), maç: G.length, turlar: [] };
for (const carry of [0]) { out.turlar.push(round([2022, 2023], 2024, carry)); out.turlar.push(round([2022, 2023, 2024], 2025, carry)); }
fs.writeFileSync(process.env.OUT || "docs/bk2y.json", JSON.stringify(out, null, 1));
for (const t of out.turlar) { console.log(`\n== öğren ${t.öğren} → sına ${t.sına}`); for (const [k, v] of Object.entries(t.sonuç)) console.log(k, "| ayar", JSON.stringify(v?.ayar), v?.ağırlık ? v.ağırlık.join(",") : "", "| öğrenme", JSON.stringify(v?.öğrenme), "| SINAV", JSON.stringify(v?.sınav)); }
