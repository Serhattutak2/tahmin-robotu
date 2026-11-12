// Son iki sezon sinavi, sitedeki kurallarla birebir. Futbol: football-data (2024-07'den bugune). Basketbol: Polymarket fiyat arsivi (data/pmhist.json, 2025-05'ten bugune).
// Oran bandi sitedeki gibi: futbol 1,70-2,50, basketbol 1,70-2,10. Kar ayri ayri: bulunan oran, bet365 ve "bahis sitesi" (Polymarket fiyati - %4,5 kesinti).
import fs from "node:fs";
import { devig, fdDate, num } from "../lib/engine.mjs";
import { getText, FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const st = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + x.v, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + (x.v - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.v > 0).length, ortOran: +(l.reduce((a, x) => a + x.o, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const by = (l, f) => Object.fromEntries(Object.entries(Object.groupBy(l, f)).sort().map(([k, v]) => [k, st(v)]));
const out = { generatedAt: new Date().toISOString() };
// ---- Futbol ----
const f = v => { const x = Number(v); return v === "" || v === undefined || !Number.isFinite(x) ? NaN : x; };
const g = (r, ks) => { const v = ks.map(k => num(r[k])); return v.every(x => Number.isFinite(x) && x > 1) ? v : null; };
const files = await mapLimit(FD_SEASONS.filter(s => s >= "2425").flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const FB = { fiyat_max: [], fiyat_b365: [], ah_b365: [], ah_max: [] };
for (const fl of files) if (fl?.rows) for (const r of fl.rows) {
  const date = fdDate(r.Date), hs = f(r.FTHG), as = f(r.FTAG); if (!date || date < "2024-07-01" || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
  const season = date < "2025-07-01" ? "2024-25" : "2025-26";
  // Motorun secimleri: en yuksek oranin %98'i adil fiyatin ustunde (MS ve 2,5 Alt/Ust); sitede yalniz bulunan oran 1,70-2,50 gosterilir.
  const fx = g(r, ["PSH", "PSD", "PSA"]) || g(r, ["AvgH", "AvgD", "AvgA"]), fo = g(r, ["P>2.5", "P<2.5"]) || g(r, ["Avg>2.5", "Avg<2.5"]), cand = [];
  if (fx) devig(fx).forEach((p, i) => cand.push({ p, mx: num(r[["MaxH", "MaxD", "MaxA"][i]]), b: num(r[["B365H", "B365D", "B365A"][i]]), y: i === 0 ? hs > as : i === 1 ? hs === as : hs < as }));
  if (fo) devig(fo).forEach((p, i) => cand.push({ p, mx: num(r[["Max>2.5", "Max<2.5"][i]]), b: num(r[["B365>2.5", "B365<2.5"][i]]), y: (hs + as > 2.5) === !i }));
  let top = null; for (const x of cand) { if (!(x.mx >= 1.3)) continue; const pr = x.mx * 0.98; if (pr < 1.3 || pr > 3.2) continue; const ev = x.p * pr - 1; if (ev >= 0 && (!top || ev > top.ev)) top = { ...x, ev }; }
  if (top) { const shown = top.b > 1 ? top.b : top.mx; if (shown >= 1.7 && shown <= 2.5) { FB.fiyat_max.push({ season, date, o: top.mx, v: top.y ? top.mx - 1 : -1 }); if (top.b > 1) FB.fiyat_b365.push({ season, date, o: top.b, v: top.y ? top.b - 1 : -1 }); } }
  // Handikap degeri: bet365 orani adil fiyatin en az %2 ustunde; bant 1,70-2,50.
  const h = f(r.AHh), fa = g(r, ["PAHH", "PAHA"]) || g(r, ["AvgAHH", "AvgAHA"]);
  if (Number.isFinite(h) && fa) { const p = devig(fa); let best = null; [0, 1].forEach(i => { const o = num(r[i ? "B365AHA" : "B365AHH"]); if (!(o >= 1.7 && o <= 2.5)) return; const ev = p[i] * o - 1; if (ev >= 0.02 && (!best || ev > best.ev)) best = { i, o, ev, mx: num(r[i ? "MaxAHA" : "MaxAHH"]) }; });
    if (best) { const line = best.i ? -h : h, d = best.i ? as - hs : hs - as, parts = Math.abs(line * 4) % 2 === 1 ? [line - 0.25, line + 0.25] : [line], pay = o => parts.reduce((a, L) => { const x = d + L; return a + (x > 0 ? o - 1 : x === 0 ? 0 : -1) / parts.length; }, 0);
      FB.ah_b365.push({ season, date, o: best.o, v: pay(best.o) }); if (best.mx > 1) FB.ah_max.push({ season, date, o: best.mx, v: pay(best.mx) }); } }
}
out.futbol = Object.fromEntries(Object.entries(FB).map(([k, l]) => [k, { hepsi: st(l), sezon: by(l, x => x.season), ay: by(l, x => x.date.slice(0, 7)) }]));
// ---- Basketbol (Polymarket fiyat arsivi) ----
const pm = JSON.parse(fs.readFileSync("data/pmhist.json", "utf8")).filter(x => x.sport === "basketball");
const BK = [];
for (const gm of pm) {
  const opts = []; if (Number.isFinite(gm.p) && gm.win !== undefined && gm.win !== null) { opts.push({ kind: "taraf", p: gm.p, y: gm.win === 0 }); opts.push({ kind: "taraf", p: 1 - gm.p, y: gm.win === 1 }); }
  for (const l of gm.lines || []) if (Number.isFinite(l.p) && l.won !== undefined && l.won !== null) { const k = l.type === "totals" ? "alt/üst" : "handikap"; opts.push({ kind: k, p: l.p, y: l.won === 0 }); opts.push({ kind: k, p: 1 - l.p, y: l.won === 1 }); }
  const ok = opts.filter(x => x.p > 0.5 && x.p < 0.84 && 1 / x.p >= 1.2).sort((a, b) => b.p - a.p)[0]; if (!ok) continue;
  const o = 1 / ok.p; if (o < 1.7 || o > 2.1 || ok.kind === "alt/üst") continue;
  const lg = /^(cbb|cwbb)$/.test(gm.league) ? "NCAA" : gm.league === "nba" ? "NBA" : gm.league === "euroleague" ? "EuroLeague" : gm.league === "wnba" ? "WNBA" : "Diğer";
  BK.push({ date: gm.end.slice(0, 10), lig: lg, kind: ok.kind, o, y: ok.y });
}
const at = (l, m) => l.map(x => ({ ...x, o: x.o * m, v: x.y ? x.o * m - 1 : -1 }));
out.basketbol = { not: "Polymarket fiyat arsivi 2025-05'ten bugune (yaklasik 1,5 sezon). Polymarket fiyatinda kesinti yok; bahis sitesi orani yaklasik %4,5 dusuk varsayildi.",
  polymarketOrani: { hepsi: st(at(BK, 1)), lig: Object.fromEntries(Object.entries(Object.groupBy(BK, x => x.lig)).map(([k, v]) => [k, st(at(v, 1))])), tür: Object.fromEntries(Object.entries(Object.groupBy(BK, x => x.kind)).map(([k, v]) => [k, st(at(v, 1))])) },
  bahisSitesiOrani: { hepsi: st(at(BK, 0.955)), lig: Object.fromEntries(Object.entries(Object.groupBy(BK, x => x.lig)).map(([k, v]) => [k, st(at(v, 0.955))])) } };
// ---- Voleybol: ucretsiz gecmis oran verisi var mi? ----
let vb = 0; try { for (const t of ["volleyball", "vnl", "volleyball-nations-league"]) { const l = JSON.parse(await getText(`https://gamma-api.polymarket.com/events?tag_slug=${t}&closed=true&limit=100`, 1)); vb += l.length; } } catch (e) { vb = -1; }
out.voleybol = { polymarketKapanmışEtkinlik: vb };
fs.writeFileSync("docs/son2.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.futbol)) console.log("FUTBOL", k, JSON.stringify(v.hepsi), JSON.stringify(Object.fromEntries(Object.entries(v.sezon).map(([s, x]) => [s, x.kar + " (" + x.seçim + ")"]))));
console.log("BASKET pm", JSON.stringify(out.basketbol.polymarketOrani.hepsi)); console.log("BASKET site", JSON.stringify(out.basketbol.bahisSitesiOrani.hepsi)); console.log("lig", JSON.stringify(out.basketbol.bahisSitesiOrani.lig)); console.log("tür", JSON.stringify(out.basketbol.polymarketOrani.tür)); console.log("VOLEYBOL", vb);
