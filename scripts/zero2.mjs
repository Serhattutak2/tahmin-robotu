// Fiyat disiplini, genis pazar: MS (1X2), 2,5 Alt/Ust ve Asya handikapi. Adil fiyat piyasadan (Pinnacle, yoksa ortalama),
// oynanan oran gercek (bet365 / ortalama / en yuksek). Oran en az 1,30. Secim donemi 2021-iki yil once, sinav son iki yil.
import fs from "node:fs";
import { devig, fdDate, num } from "../lib/engine.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const codes = Object.keys(FD_LEAGUES), seasons = FD_SEASONS.filter(s => s >= "2122");
const files = await mapLimit(seasons.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const g = (r, ks) => { const v = ks.map(k => num(r[k])); return v.every(x => Number.isFinite(x) && x > 1) ? v : null; };
const rows = [];
for (const f of files) if (f?.rows) for (const r of f.rows) {
  const date = fdDate(r.Date), hs = +r.FTHG, as = +r.FTAG; if (!date || r.FTHG === "" || !Number.isFinite(hs)) continue;
  const m = { date, code: f.c, hs, as, mk: [] };
  // 1X2
  const fx = g(r, ["PSH", "PSD", "PSA"]) || g(r, ["AvgH", "AvgD", "AvgA"]);
  if (fx) { const p = devig(fx); ["H", "D", "A"].forEach((s, i) => m.mk.push({ m: "MS", lab: ["MS 1", "MS X", "MS 2"][i], p: p[i], o: { bet365: num(r[`B365${s}`]), ortalama: num(r[`Avg${s}`]), enYüksek: num(r[`Max${s}`]) }, pay: o => (i === 0 ? hs > as : i === 1 ? hs === as : hs < as) ? o - 1 : -1 })); }
  // 2,5 Alt/Ust
  const fo = g(r, ["P>2.5", "P<2.5"]) || g(r, ["Avg>2.5", "Avg<2.5"]);
  if (fo) { const p = devig(fo); [">", "<"].forEach((s, i) => m.mk.push({ m: "AU", lab: i ? "2,5 Alt" : "2,5 Üst", p: p[i], o: { bet365: num(r[`B365${s}2.5`]), ortalama: num(r[`Avg${s}2.5`]), enYüksek: num(r[`Max${s}2.5`]) }, pay: o => ((hs + as > 2.5) === !i) ? o - 1 : -1 })); }
  // Asya handikapi (ev sahibine verilen cizgi AHh). Ceyrek cizgiler yarim yarim hesaplanir.
  const h = num(r.AHh), fa = g(r, ["PAHH", "PAHA"]) || g(r, ["AvgAHH", "AvgAHA"]);
  if (Number.isFinite(h) && fa) { const p = devig(fa); [0, 1].forEach(i => { const line = i ? -h : h, d = i ? as - hs : hs - as, parts = Math.abs(line * 4) % 2 === 1 ? [line - 0.25, line + 0.25] : [line];
    m.mk.push({ m: "AH", lab: `${i ? "Deplasman" : "Ev sahibi"} ${line > 0 ? "+" : ""}${line}`, p: p[i], o: { bet365: num(r[i ? "B365AHA" : "B365AHH"]), ortalama: num(r[i ? "AvgAHA" : "AvgAHH"]), enYüksek: num(r[i ? "MaxAHA" : "MaxAHH"]) }, pay: o => parts.reduce((a, L) => { const x = d + L; return a + (x > 0 ? o - 1 : x === 0 ? 0 : -1) / parts.length; }, 0) }); }); }
  if (m.mk.length) rows.push(m);
}
rows.sort((a, b) => a.date.localeCompare(b.date));
const cut = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10), sel = rows.filter(r => r.date < cut), test = rows.filter(r => r.date >= cut);
function bets(data, c) { const out = []; for (const m of data) { let best = null; for (const x of m.mk) { if (!c.mk.includes(x.m)) continue; const o = x.o[c.entry]; if (!Number.isFinite(o) || o < 1.3) continue; const price = o * c.cut; if (price < c.lo || price > c.hi) continue; const ev = x.p * price - 1; if (ev >= c.edge && (!best || ev > best.ev)) best = { ev, x, price }; } if (best) out.push({ date: m.date, code: m.code, mk: best.x.m, v: best.x.pay(best.price) }); } return out; }
const stat = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + x.v, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + (x.v - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.v > 0).length, kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const grid = [];
for (const mk of [["MS"], ["AU"], ["AH"], ["MS", "AU", "AH"]]) for (const entry of ["bet365", "ortalama", "enYüksek"]) for (const edge of [0, .02, .03, .05, .08]) for (const [lo, hi] of [[1.3, 2.2], [1.3, 3.2], [1.5, 3.2]]) for (const cutv of entry === "enYüksek" ? [.96, .98] : [1]) grid.push({ mk, entry, edge, lo, hi, cut: cutv });
const res = grid.map(c => ({ c, seçimDönemi: stat(bets(sel, c)), sınav: stat(bets(test, c)) }));
const top = (f) => res.filter(x => f(x.c) && x.seçimDönemi.seçim >= 300).sort((a, b) => b.seçimDönemi.getiri100 - a.seçimDönemi.getiri100)[0];
const out = { generatedAt: new Date().toISOString(), maç: rows.length, ayrım: cut, pazarSayısı: { MS: rows.filter(r => r.mk.some(x => x.m === "MS")).length, AU: rows.filter(r => r.mk.some(x => x.m === "AU")).length, AH: rows.filter(r => r.mk.some(x => x.m === "AH")).length }, seçilen: {} };
for (const mk of ["MS", "AU", "AH", "MS+AU+AH"]) for (const e of ["bet365", "ortalama", "enYüksek"]) out.seçilen[`${mk}|${e}`] = top(c => c.mk.join("+") === mk && c.entry === e) || null;
out.sınavİlk15 = res.filter(x => x.seçimDönemi.seçim >= 300 && x.seçimDönemi.getiri100 > 0).sort((a, b) => b.sınav.alt100 - a.sınav.alt100).slice(0, 15);
fs.writeFileSync("docs/zero2.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.seçilen)) console.log(k, v && JSON.stringify(v.c), v && JSON.stringify(v.seçimDönemi), v && JSON.stringify(v.sınav));
