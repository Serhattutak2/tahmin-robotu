// Deger avi kuralinin son 3 yil testi. Bahis sitesi orani: bet365 (1xBet gecmisi yok). Adil olasilik: piyasa ortalamasi ve Pinnacle'in ortalamasi.
// Kural: oran x adil >= 1,02; ortalamaya ve Pinnacle'a gore de >= 1; oran 1,30-5. Iki zaman: mactan once (B365H...) ve kapanis (B365CH...).
import fs from "node:fs";
import { devig, fdDate, num } from "../lib/engine.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const start = new Date(Date.now() - 3 * 365.25 * 864e5).toISOString().slice(0, 10), codes = Object.keys(FD_LEAGUES), seasons = FD_SEASONS.filter(s => s >= "2324");
const files = await mapLimit(seasons.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const g = (r, ks) => { const v = ks.map(k => num(r[k])); return v.every(x => Number.isFinite(x) && x > 1) ? v : null; };
const T = { önce: { b: "B365", avg: "Avg", pin: "PS", ou: ["B365>2.5", "B365<2.5"], ouAvg: ["Avg>2.5", "Avg<2.5"], ouPin: ["P>2.5", "P<2.5"], mx: "Max", ouMx: ["Max>2.5", "Max<2.5"] },
  kapanış: { b: "B365C", avg: "AvgC", pin: "PSC", ou: ["B365C>2.5", "B365C<2.5"], ouAvg: ["AvgC>2.5", "AvgC<2.5"], ouPin: ["PC>2.5", "PC<2.5"], mx: "MaxC", ouMx: ["MaxC>2.5", "MaxC<2.5"] } };
const res = {};
for (const [when, c] of Object.entries(T)) for (const book of ["bet365", "enYüksek"]) {
  const bets = [];
  for (const f of files) if (f?.rows) for (const r of f.rows) {
    const date = fdDate(r.Date), hs = +r.FTHG, as = +r.FTAG; if (!date || date < start || r.FTHG === "" || !Number.isFinite(hs)) continue;
    const mk = [];
    const bx = book === "bet365" ? g(r, [c.b + "H", c.b + "D", c.b + "A"]) : g(r, [c.mx + "H", c.mx + "D", c.mx + "A"]), ax = g(r, [c.avg + "H", c.avg + "D", c.avg + "A"]), px = g(r, [c.pin + "H", c.pin + "D", c.pin + "A"]);
    if (bx && ax) { const ap = devig(ax), pp = px && devig(px); [0, 1, 2].forEach(i => mk.push({ m: ["MS 1", "MS X", "MS 2"][i], o: bx[i], a: ap[i], p: pp?.[i], y: i === 0 ? hs > as : i === 1 ? hs === as : hs < as })); }
    const bo = book === "bet365" ? g(r, c.ou) : g(r, c.ouMx), ao = g(r, c.ouAvg), po = g(r, c.ouPin);
    if (bo && ao) { const ap = devig(ao), pp = po && devig(po); [0, 1].forEach(i => mk.push({ m: ["2,5 Üst", "2,5 Alt"][i], o: bo[i], a: ap[i], p: pp?.[i], y: (hs + as > 2.5) === !i })); }
    let best = null;
    for (const x of mk) { const pf = x.p ? (x.a + x.p) / 2 : x.a, ev = x.o * pf - 1; if (x.o < 1.3 || x.o > 5 || ev < 0.02 || x.o * x.a < 1 || (x.p && x.o * x.p < 1)) continue; if (!best || ev > best.ev) best = { ...x, ev }; }
    if (best) bets.push({ date, code: f.c, ...best, v: best.y ? best.o - 1 : -1 });
  }
  const st = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + x.v, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + (x.v - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.y).length, ortOran: +(l.reduce((a, x) => a + x.o, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
  const grp = (l, f) => Object.fromEntries(Object.entries(Object.groupBy(l, f)).sort().map(([k, v]) => [k, st(v)]));
  res[`${when}|${book}`] = { hepsi: st(bets), yıl: grp(bets, x => x.date.slice(0, 4)), pazar: grp(bets, x => x.m), oranBandı: grp(bets, x => x.o < 1.6 ? "1,30-1,60" : x.o < 2.2 ? "1,60-2,20" : x.o < 3.2 ? "2,20-3,20" : "3,20-5") };
}
fs.writeFileSync("docs/x1test.json", JSON.stringify({ generatedAt: new Date().toISOString(), başlangıç: start, sonuç: res }, null, 1));
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v.hepsi), JSON.stringify(v.yıl));
