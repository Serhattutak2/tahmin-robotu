// Erken oran testi: bet365'in kapanistan once toplanan orani (B365H...) kapanis adil oranina gore hangi lig x pazar x oran bandinda
// duzenli olarak yuksek kaliyor? Secim donemi 2021/22-2023/24, sinav 2024/25-bugun. Sinavda bet365 orani ile kar ve kapanis farki.
import fs from "node:fs";
import { devig, fdDate, num } from "../lib/engine.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const codes = Object.keys(FD_LEAGUES), seasons = FD_SEASONS.filter(s => s >= "2122");
const files = await mapLimit(seasons.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const g = (r, ks) => { const v = ks.map(k => num(r[k])); return v.every(x => Number.isFinite(x) && x > 1) ? v : null; };
const BANDS = [[1.3, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 6]], band = o => BANDS.findIndex(([a, b]) => o >= a && o < b);
const bets = [];
for (const f of files) if (f?.rows) for (const r of f.rows) {
  const date = fdDate(r.Date), hs = +r.FTHG, as = +r.FTAG; if (!date || r.FTHG === "" || !Number.isFinite(hs)) continue;
  const cx = g(r, ["PSCH", "PSCD", "PSCA"]) || g(r, ["AvgCH", "AvgCD", "AvgCA"]), bx = g(r, ["B365H", "B365D", "B365A"]), px = g(r, ["PSH", "PSD", "PSA"]) || g(r, ["AvgH", "AvgD", "AvgA"]);
  if (cx && bx && px) { const pc = devig(cx), pp = devig(px); ["H", "D", "A"].forEach((s, i) => bets.push({ date, code: f.c, mk: s, o: bx[i], p0: pp[i], pc: pc[i], y: i === 0 ? hs > as : i === 1 ? hs === as : hs < as })); }
  const co = g(r, ["PC>2.5", "PC<2.5"]) || g(r, ["AvgC>2.5", "AvgC<2.5"]), bo = g(r, ["B365>2.5", "B365<2.5"]), po = g(r, ["P>2.5", "P<2.5"]) || g(r, ["Avg>2.5", "Avg<2.5"]);
  if (co && bo && po) { const pc = devig(co), pp = devig(po); ["Ü", "A"].forEach((s, i) => bets.push({ date, code: f.c, mk: s, o: bo[i], p0: pp[i], pc: pc[i], y: (hs + as > 2.5) === !i })); }
}
for (const b of bets) { b.b = band(b.o); b.clv = b.o * b.pc - 1; b.v = b.y ? b.o - 1 : -1; }
const ok = bets.filter(b => b.b >= 0), cut = "2024-07-01", sel = ok.filter(b => b.date < cut), test = ok.filter(b => b.date >= cut);
const st = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + x.v, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + (x.v - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.y).length, ortOran: +(l.reduce((a, x) => a + x.o, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1), kapanış100: +(l.reduce((a, x) => a + x.clv, 0) / l.length * 100).toFixed(2) }; };
const MK = { H: "MS 1", D: "MS X", A: "MS 2", "Ü": "2,5 Üst", A2: "2,5 Alt" }, mkName = m => m === "A" ? "MS 2" : m === "Ü" ? "2,5 Üst" : m === "D" ? "MS X" : m === "H" ? "MS 1" : "2,5 Alt";
const keyOf = (b, lvl) => lvl === "lig" ? `${b.code}|${b.mk === "A" && b.o && false ? "" : b.mk}|${b.b}` : `${b.mk}|${b.b}`;
const out = { generatedAt: new Date().toISOString(), ayrım: cut, bahis: ok.length, hepsiSınav: st(test), yöntemler: {} };
// Yontem 1/2: secim doneminde kapanis farki artida olan gruplar (lig x pazar x bant ya da pazar x bant)
for (const [name, lvl, minN, thr] of [["ligPazarBant", "lig", 120, 0.01], ["ligPazarBantSıkı", "lig", 200, 0.02], ["pazarBant", "genel", 500, 0.0]]) {
  const grp = Object.groupBy(sel, b => keyOf(b, lvl)), pick = Object.entries(grp).filter(([, l]) => l.length >= minN).map(([k, l]) => ({ k, s: st(l) })).filter(x => x.s.kapanış100 / 100 > thr && x.s.getiri100 > 0).map(x => x.k);
  const set = new Set(pick), tb = test.filter(b => set.has(keyOf(b, lvl)));
  out.yöntemler[name] = { grupSayısı: pick.length, seçimDönemi: st(sel.filter(b => set.has(keyOf(b, lvl)))), sınav: st(tb), sınavYıl: Object.fromEntries(Object.entries(Object.groupBy(tb, b => b.date.slice(0, 4))).map(([y, l]) => [y, st(l)])), gruplar: pick.map(k => { const [a, b, c] = k.split("|"); return lvl === "lig" ? { lig: FD_LEAGUES[a], kod: a, pazar: mkName(b), bant: BANDS[+c] } : { pazar: mkName(a), bant: BANDS[+b] }; }) };
}
// Yontem 3: bet365 erken orani, erken adil fiyatin ustunde (keskin-yumusak farki) — sadece bet365
for (const e of [0, 0.02, 0.04]) { const f = b => b.o * b.p0 - 1 >= e; out.yöntemler[`erkenDeğer${e}`] = { seçimDönemi: st(sel.filter(f)), sınav: st(test.filter(f)) }; }
fs.writeFileSync("docs/early.json", JSON.stringify(out, null, 1));
const best = out.yöntemler.ligPazarBant; fs.writeFileSync("config/early.json", JSON.stringify({ generatedAt: out.generatedAt, gruplar: best.gruplar, sınav: best.sınav }, null, 1));
for (const [k, v] of Object.entries(out.yöntemler)) console.log(k, v.grupSayısı ?? "", JSON.stringify(v.seçimDönemi), JSON.stringify(v.sınav));
console.log("hepsi", JSON.stringify(out.hepsiSınav));
