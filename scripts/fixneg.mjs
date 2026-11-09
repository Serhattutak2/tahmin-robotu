// Eksi bolumleri duzeltme testi (futbol). Arastirma: 1X2'de yuksek oranli bahisler sistematik kaybettirir (Hegarty & Whelan 2025),
// Asya handikabinda bu yok ve kesinti dusuk. Onceki testte handikap cizgisi oran gibi okunmustu (hata) - burada duzgun.
// Kitap kumeleri: yalniz bet365 / bet365+Bet&Win / bet365+Bet&Win+William Hill (2-3 hesap) / en yuksek oran.
// Adil fiyat: Pinnacle (yoksa piyasa ortalamasi), mac oncesi. Ayar 2021-22..2023-24 ile secilir, 2024-25..bugun sinanir.
import fs from "node:fs";
import { devig, fdDate, num } from "../lib/engine.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const codes = Object.keys(FD_LEAGUES), seasons = FD_SEASONS.filter(s => s >= "2122");
const files = await mapLimit(seasons.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const f = v => { const x = Number(v); return v === "" || v === undefined || !Number.isFinite(x) ? NaN : x; };
const g = (r, ks) => { const v = ks.map(k => num(r[k])); return v.every(x => Number.isFinite(x) && x > 1) ? v : null; };
const BOOKS = { "yalnız bet365": ["B365"], "2 hesap (bet365 + Bet&Win)": ["B365", "BW"], "3 hesap (bet365 + Bet&Win + W.Hill)": ["B365", "BW", "WH"], "en yüksek oran": ["Max"] };
const M = [];
for (const fl of files) if (fl?.rows) for (const r of fl.rows) {
  const date = fdDate(r.Date), hs = f(r.FTHG), as = f(r.FTAG); if (!date || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
  const m = { date, code: fl.c, legs: [] };
  const fx = g(r, ["PSH", "PSD", "PSA"]) || g(r, ["AvgH", "AvgD", "AvgA"]);
  if (fx) { const p = devig(fx); ["H", "D", "A"].forEach((s, i) => m.legs.push({ mk: "1X2", lab: ["MS 1", "MS X", "MS 2"][i], p: p[i], o: Object.fromEntries(Object.entries(BOOKS).map(([k, bs]) => [k, Math.max(...bs.map(b => num(r[b + s])).filter(x => x > 1), -1)])), pay: o => (i === 0 ? hs > as : i === 1 ? hs === as : hs < as) ? o - 1 : -1 })); }
  const fo = g(r, ["P>2.5", "P<2.5"]) || g(r, ["Avg>2.5", "Avg<2.5"]);
  if (fo) { const p = devig(fo); [">", "<"].forEach((s, i) => m.legs.push({ mk: "Alt/Üst", lab: i ? "2,5 Alt" : "2,5 Üst", p: p[i], o: { "yalnız bet365": num(r[`B365${s}2.5`]), "2 hesap (bet365 + Bet&Win)": num(r[`B365${s}2.5`]), "3 hesap (bet365 + Bet&Win + W.Hill)": num(r[`B365${s}2.5`]), "en yüksek oran": num(r[`Max${s}2.5`]) }, pay: o => ((hs + as > 2.5) === !i) ? o - 1 : -1 })); }
  const h = f(r.AHh), fa = g(r, ["PAHH", "PAHA"]) || g(r, ["AvgAHH", "AvgAHA"]);
  if (Number.isFinite(h) && fa) { const p = devig(fa); [0, 1].forEach(i => { const line = i ? -h : h, d = i ? as - hs : hs - as, parts = Math.abs(line * 4) % 2 === 1 ? [line - 0.25, line + 0.25] : [line];
    m.legs.push({ mk: "Handikap", lab: `${i ? "Dep" : "Ev"} ${line > 0 ? "+" : ""}${line}`, p: p[i], o: { "yalnız bet365": num(r[i ? "B365AHA" : "B365AHH"]), "2 hesap (bet365 + Bet&Win)": num(r[i ? "B365AHA" : "B365AHH"]), "3 hesap (bet365 + Bet&Win + W.Hill)": num(r[i ? "B365AHA" : "B365AHH"]), "en yüksek oran": num(r[i ? "MaxAHA" : "MaxAHH"]) },
      pay: o => parts.reduce((acc, L) => { const x = d + L; return acc + (x > 0 ? o - 1 : x === 0 ? 0 : -1) / parts.length; }, 0) }); }); }
  if (m.legs.length) M.push(m);
}
M.sort((a, b) => a.date.localeCompare(b.date));
const CUT = "2024-07-01", sel = M.filter(m => m.date < CUT), test = M.filter(m => m.date >= CUT);
const bets = (data, c) => { const out = []; for (const m of data) { let best = null; for (const x of m.legs) { if (!c.mk.includes(x.mk)) continue; const o = x.o[c.book]; if (!(o >= c.lo && o <= c.hi)) continue; const ev = x.p * o - 1; if (ev >= c.edge && (!best || ev > best.ev)) best = { ev, x, o }; } if (best) out.push({ date: m.date, mk: best.x.mk, o: best.o, p: best.x.p, v: best.x.pay(best.o) }); } return out; };
const st = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + x.v, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + (x.v - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.v > 0).length, ortOran: +(l.reduce((a, x) => a + x.o, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const MKS = [["1X2"], ["Alt/Üst"], ["Handikap"], ["1X2", "Alt/Üst", "Handikap"]], out = { generatedAt: new Date().toISOString(), maç: M.length, handikaplıMaç: M.filter(m => m.legs.some(x => x.mk === "Handikap")).length, ayrım: CUT, tekli: {}, kupon: {} };
for (const book of Object.keys(BOOKS)) for (const mk of MKS) {
  const grid = []; for (const edge of [0, 0.01, 0.02, 0.03, 0.05]) for (const [lo, hi] of [[1.3, 2.0], [1.3, 2.5], [1.3, 3.2], [1.3, 5]]) grid.push({ book, mk, edge, lo, hi });
  const g2 = grid.map(c => ({ c, s: st(bets(sel, c)) })).filter(x => x.s.seçim >= 200).sort((a, b) => b.s.getiri100 - a.s.getiri100)[0]; if (!g2) continue;
  const tb = bets(test, g2.c);
  out.tekli[`${book} | ${mk.join("+")}`] = { ayar: { kesinti: g2.c.edge, oran: [g2.c.lo, g2.c.hi] }, seçimDönemi: g2.s, sınav: st(tb), sınavYıl: Object.fromEntries(Object.entries(Object.groupBy(tb, x => x.date.slice(0, 4))).map(([y, l]) => [y, st(l)])) };
}
// Kupon onarimi: ayni gun, iki ayri macin degerli ayaklari (her ayak kendi basina adil fiyatin ustunde, dusuk oran bandinda).
for (const book of Object.keys(BOOKS)) {
  const run = (data, c) => { const byDay = Object.groupBy(bets(data, c).map((b, i) => ({ ...b, i })), b => b.date), res = []; for (const l of Object.values(byDay)) { const s = l.sort((a, b) => b.p - a.p); for (let k = 0; k + 1 < s.length && k < 4; k += 2) { const a = s[k], b = s[k + 1], o = a.o * b.o, w = a.v > 0 && b.v > 0; res.push({ date: a.date, o, v: w ? o - 1 : -1 }); } } return res; };
  const grid = []; for (const edge of [0, 0.02, 0.03]) for (const [lo, hi] of [[1.3, 1.7], [1.3, 2.0], [1.4, 2.2]]) grid.push({ book, mk: ["1X2", "Alt/Üst", "Handikap"], edge, lo, hi });
  const g2 = grid.map(c => ({ c, s: st(run(sel, c)) })).filter(x => x.s.seçim >= 150).sort((a, b) => b.s.getiri100 - a.s.getiri100)[0]; if (!g2) continue;
  out.kupon[book] = { ayar: { kesinti: g2.c.edge, ayakOran: [g2.c.lo, g2.c.hi] }, seçimDönemi: g2.s, sınav: st(run(test, g2.c)) };
}
fs.writeFileSync("docs/fixneg.json", JSON.stringify(out, null, 1));
console.log("maç", out.maç, "handikaplı", out.handikaplıMaç);
for (const [k, v] of Object.entries(out.tekli)) console.log("TEKLİ", k, JSON.stringify(v.ayar), "| seç", v.seçimDönemi.kar, v.seçimDönemi.seçim, v.seçimDönemi.getiri100, "| SINAV", JSON.stringify(v.sınav));
for (const [k, v] of Object.entries(out.kupon)) console.log("KUPON", k, JSON.stringify(v.ayar), "| seç", v.seçimDönemi.kar, v.seçimDönemi.seçim, "| SINAV", JSON.stringify(v.sınav));
