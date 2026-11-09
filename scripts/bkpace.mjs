// Tempo x verimlilik modeli (basketbola ozel): her takimin mac basina hucum sayisi (tempo), 100 hucumda attigi ve yedigi sayi.
// Veri: shufinskiy/nba_data oyun anlari (2022-23 .. 2025-26), cizgi: kyleskom OddsData acilis cizgileri. Ogren-sina dongusu bk2y ile ayni.
import fs from "node:fs";
import { BModel, bOver } from "../lib/basket2.mjs";
import { cdf } from "../lib/basket.mjs";
const BOX = JSON.parse(fs.readFileSync(process.env.NBABOX, "utf8")), RAW = JSON.parse(fs.readFileSync(process.env.NBA2226, "utf8"));
const nick = n => { const w = String(n).trim().split(/\s+/).at(-1).toLowerCase(); return w === "bobcats" ? "hornets" : w; };
const seasonOf = d => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 8 ? y : y - 1; };
const lineOf = new Map(); for (const g of RAW) { const h = nick(g.h); for (const dd of [0, 1]) { const d = new Date(Date.parse(g.day) + dd * 864e5).toISOString().slice(0, 10); lineOf.set(`${d}|${h}`, g.ou); } }
function rows({ a = 0.1, fresh = true } = {}) {
  const T = {}, team = n => (T[n] ||= { pace: null, o: null, d: null, g: 0 }), out = []; let season = null, lg = { pace: 98, r: 114 };
  const P = new BModel({ lr: 0.1, home: 2, mean: 112, carry: fresh ? 0 : 1 });
  for (const g of BOX) {
    const s = seasonOf(g.day); if (s !== season) { season = s; P.newSeason(s); if (fresh) for (const k in T) T[k] = { pace: null, o: null, d: null, g: 0 }; }
    const H = team(g.h), A = team(g.a), line = lineOf.get(`${g.day}|${g.h}`), tot = g.hs + g.as;
    if (H.g >= 10 && A.g >= 10 && Number.isFinite(line) && tot !== line) {
      const pace = lg.pace + (H.pace - lg.pace) + (A.pace - lg.pace), rh = lg.r + (H.o - lg.r) + (A.d - lg.r) + 1, ra = lg.r + (A.o - lg.r) + (H.d - lg.r) - 1, exp = pace * (rh + ra) / 100;
      const pp = P.predict(g.h, g.a, g.day);
      out.push({ season: s, day: g.day, po: g.po, line, exp, pexp: pp.total, y: tot > line, res: tot - exp });
    }
    const pg = (g.ph + g.pa) / 2, oh = g.hs / pg * 100, oa = g.as / pg * 100, ew = (x, v) => x === null ? v : x * (1 - a) + v * a;
    H.pace = ew(H.pace, pg); A.pace = ew(A.pace, pg); H.o = ew(H.o, oh); H.d = ew(H.d, oa); A.o = ew(A.o, oa); A.d = ew(A.d, oh); H.g++; A.g++;
    lg.pace = lg.pace * 0.99 + pg * 0.01; lg.r = lg.r * 0.99 + (oh + oa) / 2 * 0.01;
    P.update(g.h, g.a, g.hs, g.as, g.day);
  }
  return out;
}
const st = l => { if (!l.length) return { seçim: 0 }; const v = l.map(b => b.win ? .91 : -1), pr = v.reduce((x, y) => x + y, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((x, y) => x + (y - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(b => b.win).length, kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const TH = [0.52, 0.54, 0.56, 0.58, 0.6, 0.62, 0.65, 0.68, 0.7];
const out = { generatedAt: new Date().toISOString(), turlar: [] };
for (const [learnS, testS] of [[[2022, 2023], 2024], [[2022, 2023, 2024], 2025]]) {
  const best = {};
  for (const a of [0.05, 0.1, 0.2]) for (const fresh of [true, false]) {
    const R = rows({ a, fresh }), L = R.filter(r => learnS.includes(r.season)), Tt = R.filter(r => r.season === testS);
    const sd = Math.sqrt(L.reduce((s, r) => s + r.res ** 2, 0) / L.length), sdP = 18;
    const C = { "Tempo modeli": r => 1 - cdf((r.line - r.exp) / sd), "Tempo modeli ters": r => cdf((r.line - r.exp) / sd), "Tempo + sayı modeli ortalaması": r => ((1 - cdf((r.line - r.exp) / sd)) + (1 - cdf((r.line - r.pexp) / sdP))) / 2, "İki model aynı yöndeyse": r => { const p1 = 1 - cdf((r.line - r.exp) / sd), p2 = 1 - cdf((r.line - r.pexp) / sdP); return Math.sign(p1 - .5) === Math.sign(p2 - .5) ? (p1 + p2) / 2 : .5; } };
    for (const [name, pf] of Object.entries(C)) { const bet = (rs, t) => rs.map(r => { const p = pf(r), c = Math.max(p, 1 - p); return c >= t ? { win: (p >= .5) === r.y } : null; }).filter(Boolean);
      const g = TH.map(t => ({ t, l: st(bet(L, t)) })).filter(x => x.l.seçim >= 150).sort((x, y) => y.l.getiri100 - x.l.getiri100)[0];
      if (g && (!best[name] || g.l.getiri100 > best[name].öğrenme.getiri100)) best[name] = { ayar: { hız: a, sezonaSıfırdan: fresh, eşik: g.t }, öğrenme: g.l, sınav: st(bet(Tt, g.t)), sınavMaç: Tt.length }; }
  }
  out.turlar.push({ öğren: learnS, sına: testS, sonuç: best });
  console.log(`\n== öğren ${learnS} → sına ${testS}`); for (const [k, v] of Object.entries(best)) console.log(k, "|", JSON.stringify(v.ayar), "| öğrenme", JSON.stringify(v.öğrenme), "| SINAV", JSON.stringify(v.sınav));
}
fs.writeFileSync(process.env.OUT || "docs/bkpace.json", JSON.stringify(out, null, 1));
