// Futbol: eski maclarin dersi GERCEK bet365 oranlariyla.
// Olasilik: mac oncesi Pinnacle oranlari (kesintisi en dusuk, en dogru piyasa; canli robot da fixtures.csv'den ayni veriyi gorur).
// Oran: mac oncesi bet365 (kullanicinin bulabilecegi tipik site orani). Pazarlar: MS 1/X/2, 2,5 Alt/Ust, Asya handikap.
// Egitim 2017-2023, sinav 2023 sonrasi. Amac: hangi bahis turu, olasilik ve oran araliginda, gercek oranla para kazandirmis?
import fs from "node:fs";
import { fdDate } from "../lib/engine.mjs";
import { FD_SEASONS, ALL_LEAGUES, EXTRA_LEAGUES, fdSeason, mapLimit } from "../lib/sources.mjs";
const N = v => { const x = Number(v); return v === "" || v == null || !Number.isFinite(x) || x <= 1 ? null : x; };
const dv = a => { if (!a || a.some(v => !v)) return null; const s = a.reduce((t, v) => t + 1 / v, 0); return a.map(v => 1 / v / s); };
const fdCodes = Object.keys(ALL_LEAGUES).filter(c => !(c in EXTRA_LEAGUES));
const files = await mapLimit(FD_SEASONS.flatMap(s => fdCodes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c).catch(() => null) }));
const bets = [];
for (const f of files) for (const r of f?.rows || []) {
  const d = fdDate(r.Date); if (!d || r.FTHG === "" || !Number.isFinite(+r.FTHG)) continue; const gh = +r.FTHG, ga = +r.FTAG;
  const p = dv([N(r.PSH), N(r.PSD), N(r.PSA)]), b = [N(r.B365H), N(r.B365D), N(r.B365A)];
  if (p && b.every(Boolean)) [["MS1", 0, gh > ga], ["MSX", 1, gh === ga], ["MS2", 2, gh < ga]].forEach(([k, i, w]) => bets.push({ d, lg: f.c, mid: d + r.HomeTeam, k, p: p[i], o: b[i], w: w ? 1 : 0 }));
  const po = dv([N(r["P>2.5"]), N(r["P<2.5"])]), bo = [N(r["B365>2.5"]), N(r["B365<2.5"])];
  if (po && bo.every(Boolean)) [["U25", 0, gh + ga > 2.5], ["A25", 1, gh + ga < 2.5]].forEach(([k, i, w]) => bets.push({ d, lg: f.c, mid: d + r.HomeTeam, k, p: po[i], o: bo[i], w: w ? 1 : 0 }));
  const L = Number(r.AHh), pa = dv([N(r.PAHH), N(r.PAHA)]), ba = [N(r.B365AHH), N(r.B365AHA)];
  if (Number.isFinite(L) && pa && ba.every(Boolean)) for (const [k, i] of [["AHH", 0], ["AHA", 1]]) {
    const diff = i === 0 ? (gh + L) - ga : (ga - L) - gh, o = ba[i];
    const one = (x, st) => x > 0 ? st * (o - 1) : x < 0 ? -st : 0;
    const q = Math.abs(Math.round(L * 4)) % 2 === 1, pay = q ? one(diff - 0.25, 0.5) + one(diff + 0.25, 0.5) : one(diff, 1);
    bets.push({ d, lg: f.c, mid: d + r.HomeTeam, k, p: pa[i], o, w: pay > 0 ? 1 : 0, pay });
  }
}
const SPLIT = "2023-07-01", T = x => x.d < SPLIT ? "egitim" : "sinav";
const pay = x => x.pay ?? (x.w ? x.o - 1 : -1);
// cyrek: w 0.75 = yarim kazanc, 0.25 = yarim kayip
const agg = L => { const n = L.length; if (!n) return null; const k = L.reduce((a, x) => a + pay(x), 0); return { n, isabet: +(L.reduce((a, x) => a + x.w, 0) / n * 100).toFixed(1), kar100: +(k / n * 100).toFixed(2) }; };
const out = { bahis: bets.length, gunler: new Set(bets.map(x => x.d)).size };
// 1) pazar x oran bandi
const ob = o => o < 1.4 ? "1,30-1,40" : o < 1.6 ? "1,40-1,60" : o < 1.9 ? "1,60-1,90" : o < 2.3 ? "1,90-2,30" : "2,30+";
out.pazarOran = {}; for (const k of ["MS1", "MSX", "MS2", "U25", "A25", "AHH", "AHA"]) for (const band of ["1,30-1,40", "1,40-1,60", "1,60-1,90", "1,90-2,30"]) { const L = bets.filter(x => x.k === k && x.o >= 1.3 && ob(x.o) === band); const e = agg(L.filter(x => T(x) === "egitim")), s = agg(L.filter(x => T(x) === "sinav")); if (e && e.n >= 200) out.pazarOran[`${k} ${band}`] = { egitim: e, sinav: s }; }
// 2) deger: Pinnacle olasiligi x bet365 orani - 1
out.deger = {}; for (const th of [-0.02, 0, 0.02, 0.04, 0.06]) for (const [lo, hi] of [[1.4, 2.5], [1.4, 1.9]]) { const L = bets.filter(x => x.o >= lo && x.o <= hi && x.p * x.o - 1 >= th); out.deger[`deger>=${th} oran ${lo}-${hi}`] = { egitim: agg(L.filter(x => T(x) === "egitim")), sinav: agg(L.filter(x => T(x) === "sinav")), gunlukSinav: +(L.filter(x => T(x) === "sinav").length / new Set(bets.filter(x => T(x) === "sinav").map(x => x.d)).size).toFixed(1) }; }
// 3) deger, pazar bazinda (deger>=0.02, oran 1,40-2,50)
out.degerPazar = {}; for (const k of ["MS1", "MSX", "MS2", "U25", "A25", "AHH", "AHA"]) { const L = bets.filter(x => x.k === k && x.o >= 1.4 && x.o <= 2.5 && x.p * x.o - 1 >= 0.02); out.degerPazar[k] = { egitim: agg(L.filter(x => T(x) === "egitim")), sinav: agg(L.filter(x => T(x) === "sinav")) }; }
// 4) lig bazinda (deger>=0.02)
out.degerLig = {}; for (const lg of new Set(bets.map(x => x.lg))) { const L = bets.filter(x => x.lg === lg && x.o >= 1.4 && x.o <= 2.5 && x.p * x.o - 1 >= 0.02); const e = agg(L.filter(x => T(x) === "egitim")), s = agg(L.filter(x => T(x) === "sinav")); if (e && e.n >= 100) out.degerLig[lg] = { egitim: e, sinav: s }; }
// 5) gunun en iyi N'i: her gun deger (p*o-1) en yuksek N bahis (oran 1,40-2,50, mac basina tek)
out.gununEnIyisi = {}; for (const Nn of [5, 10, 15]) for (const ph of ["egitim", "sinav"]) { const byDay = {}; for (const x of bets) if (T(x) === ph && x.o >= 1.4 && x.o <= 2.5) (byDay[x.d] ||= []).push(x); const L = []; for (const arr of Object.values(byDay)) { arr.sort((a, b) => (b.p * b.o) - (a.p * a.o)); let c = 0; const used = new Set(); for (const x of arr) { if (c >= Nn) break; if (used.has(x.mid)) continue; used.add(x.mid); c++; L.push(x); } } out.gununEnIyisi[`ilk${Nn} ${ph}`] = { ...agg(L), ortDeger: +(L.reduce((a, x) => a + x.p * x.o - 1, 0) / L.length * 100).toFixed(2) }; }
fs.writeFileSync("docs/ftreal.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.deger, null, 1));
