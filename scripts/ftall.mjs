// Futbol: tum pazarlarin istatistiksel analizi.
// Her mac icin kapanis oranlarindan (1X2 + 2,5 alt/ust) iki takimin gol beklentisi cikarilir, buradan ~50 pazarin olasiligi hesaplanir
// (taraf, cifte sans, alt/ust 0,5-5,5, karsilikli gol, takim golleri, handikap, kombine, ilk yari).
// Sonra her pazar icin "hesaplanan olasilik" ile "gercekte tutma orani" karsilastirilir. Egitim: 2017-2023, sinav: 2023 sonrasi.
// Sinavda: her macta, egitimde duzeltilmis olasiligi 0,62-0,79 olan pazarlardan biri secilir; en az oran 1,03/p kabul edilir.
import fs from "node:fs";
import { devig, fdDate } from "../lib/engine.mjs";
import { oddsOf } from "../lib/ratings.mjs";
import { MARKETS, marketProbs, outcome, fitCal, applyCal } from "../lib/markets.mjs";
import { FD_SEASONS, ALL_LEAGUES, EXTRA_LEAGUES, fdSeason, extraRows, mapLimit } from "../lib/sources.mjs";

const fact = [1]; for (let i = 1; i < 14; i++) fact[i] = fact[i - 1] * i; const po = (l, k) => Math.exp(-l) * l ** k / fact[k];
// gol beklentisi tablosu: (lh, la) -> (P1, P2, P ust 2,5)
const GRID = []; for (let lh = 0.2; lh <= 4.0; lh += 0.04) for (let la = 0.15; la <= 3.6; la += 0.04) { let h = 0, a = 0, o = 0, t = 0; for (let i = 0; i < 11; i++) for (let j = 0; j < 11; j++) { const p = po(lh, i) * po(la, j); t += p; if (i > j) h += p; else if (i < j) a += p; if (i + j > 2.5) o += p; } GRID.push([lh, la, h / t, a / t, o / t]); }
const fitGoals = (p1, p2, pO) => { let best = null, bv = 1e9; for (const g of GRID) { const v = (g[2] - p1) ** 2 + (g[3] - p2) ** 2 + (pO == null ? 0 : (g[4] - pO) ** 2); if (v < bv) { bv = v; best = g; } } return best && [best[0], best[1]]; };

const fdCodes = Object.keys(ALL_LEAGUES).filter(c => !(c in EXTRA_LEAGUES));
const files = await mapLimit(FD_SEASONS.flatMap(s => fdCodes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c).catch(() => null) }));
const rows = [];
for (const f of files) for (const r of f?.rows || []) { const d = fdDate(r.Date); if (!d || r.FTHG === "" || !Number.isFinite(+r.FTHG)) continue; const o = oddsOf(r); const c = o.close || o.fair, q = o.ouClose || o.ouFair; if (!c) continue; const p = devig(c), u = q && devig(q); if (!p) continue;
  rows.push({ d, code: f.c, gh: +r.FTHG, ga: +r.FTAG, hth: r.HTHG === "" || r.HTHG == null ? null : +r.HTHG, hta: r.HTAG === "" || r.HTAG == null ? null : +r.HTAG, p, pO: u ? u[1] : null, hasOU: !!u }); }
// Not: devig(ou) sirasi [ust, alt] mi [alt, ust] mu? oddsOf ou = [>2.5, <2.5] -> u[0] = ust olasiligi.
for (const r of rows) if (r.hasOU) { const q = r.pO; r.pO = null; r.pO = q; }
rows.sort((a, b) => a.d.localeCompare(b.d));
const out = { maç: rows.length, ilk: rows[0]?.d, son: rows.at(-1)?.d };

// u sirasini kontrol: ortalama ust olasiligi ve gercek ust orani
{ const s = rows.filter(r => r.hasOU); const fixOrder = (() => { // devig([ust, alt]) -> [ust, alt]; pO'yu ust olarak sec
  return true; })(); }
for (const f of files) void f;
const data = [];
for (const r of rows) {
  // pO: devig(q) => [P(>2.5), P(<2.5)]; yukarida u[1] alindi (alt). Duzelt: ust = 1 - u[1]
  const pOver = r.hasOU ? 1 - r.pO : null;
  const g = fitGoals(r.p[0], r.p[2], pOver); if (!g) continue;
  const mp = marketProbs(g[0], g[1]);
  data.push({ d: r.d, code: r.code, gh: r.gh, ga: r.ga, hth: r.hth, hta: r.hta, lh: g[0], la: g[1], mp, hasOU: r.hasOU });
}
out.hesaplanan = data.length;
const SPLIT = "2023-07-01", train = data.filter(x => x.d < SPLIT), test = data.filter(x => x.d >= SPLIT);
out.egitim = train.length; out.sinav = test.length;

// 1) Pazar bazinda kalibrasyon (ham olasilik dogru mu?)
const cal = {}, kal = {};
for (const m of MARKETS) {
  const pairs = train.flatMap(x => { const y = outcome(m, x.gh, x.ga, x.hth, x.hta); return y === null ? [] : [[x.mp[m.key], y]]; });
  cal[m.key] = fitCal(pairs.slice(-60000), 200);
  const band = (rs, lo, hi, useCal) => { let n = 0, w = 0, ps = 0; for (const x of rs) { const y = outcome(m, x.gh, x.ga, x.hth, x.hta); if (y === null) continue; const p = useCal ? applyCal(x.mp[m.key], cal[m.key]) : x.mp[m.key]; if (p < lo || p >= hi) continue; n++; w += y; ps += p; } return n ? { n, tahmin: +(ps / n * 100).toFixed(1), gercek: +(w / n * 100).toFixed(1) } : null; };
  kal[m.key] = { ad: m.label, egitim_062_079: band(train, 0.62, 0.79, false), sinav_ham_062_079: band(test, 0.62, 0.79, false), sinav_duzeltilmis_062_079: band(test, 0.62, 0.79, true) };
}
out.kalibrasyon = kal; out.duzeltme = cal;

// 2) Pazar bazinda sinav: duzeltilmis p 0,62-0,79 olan her secim icin, en az oran 1,03/p ile oynansa kar
const perMarket = {};
for (const m of MARKETS) { let n = 0, w = 0, kar = 0; for (const x of test) { const y = outcome(m, x.gh, x.ga, x.hth, x.hta); if (y === null) continue; const p = applyCal(x.mp[m.key], cal[m.key]); if (p < 0.62 || p > 0.79) continue; const odd = Math.max(1.3, 1.03 / p); n++; if (y) { w++; kar += odd - 1; } else kar -= 1; } if (n >= 200) perMarket[m.key] = { ad: m.label, n, isabet: +(w / n * 100).toFixed(1), kar100: +(kar / n * 100).toFixed(2) }; }
out.pazarSinavi = Object.fromEntries(Object.entries(perMarket).sort((a, b) => b[1].kar100 - a[1].kar100));

// 3) Egitimde "hesap tutma oranini dusuk tahmin eden" (gercek > tahmin) pazarlari bul, sinavda yalniz onlari kullan
const edge = {}; for (const m of MARKETS) { const k = kal[m.key].egitim_062_079; if (k && k.n >= 500) edge[m.key] = +(k.gercek - k.tahmin).toFixed(2); }
out.egitimFarki = Object.fromEntries(Object.entries(edge).sort((a, b) => b[1] - a[1]));
const good = Object.keys(edge).filter(k => edge[k] >= 1.0);
out.secilenPazarlar = good.map(k => `${k} ${MARKETS.find(m => m.key === k).label}`);
// mac basina tek secim: secilen pazarlardan duzeltilmis olasiligi en yuksek olan (0,62-0,79)
const pickOne = (x, keys) => { let b = null; for (const k of keys) { const m = MARKETS.find(q => q.key === k), p = applyCal(x.mp[k], cal[k]); if (p < 0.62 || p > 0.79) continue; if (outcome(m, x.gh, x.ga, x.hth, x.hta) === null) continue; if (!b || p > b.p) b = { k, p, m }; } return b; };
const evalSet = (keys, rs) => { let n = 0, w = 0, kar = 0; const by = {}; for (const x of rs) { const b = pickOne(x, keys); if (!b) continue; const y = outcome(b.m, x.gh, x.ga, x.hth, x.hta), odd = Math.max(1.3, 1.03 / b.p); n++; by[b.k] = (by[b.k] || 0) + 1; if (y) { w++; kar += odd - 1; } else kar -= 1; } return { n, isabet: +(w / n * 100).toFixed(1), kar: +kar.toFixed(1), kar100: +(kar / n * 100).toFixed(2), dagilim: Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12)) }; };
out.sinav_secilenPazarlar = evalSet(good, test);
out.sinav_tumPazarlar = evalSet(MARKETS.map(m => m.key), test);
out.sinav_sadeceTaraf = evalSet(["MS1", "MS2", "1X", "X2", "12"], test);
// sezon sezon (secilen pazarlar)
out.sinav_sezon = {}; for (const y of ["2023-07", "2024-07", "2025-07"]) { const e = String(+y.slice(0, 4) + 1) + "-07"; out.sinav_sezon[y.slice(0, 4)] = evalSet(good, test.filter(x => x.d >= y + "-01" && x.d < e + "-01")); }
fs.writeFileSync("docs/ftall.json", JSON.stringify({ ...out, duzeltme: undefined }, null, 1));
fs.mkdirSync("config", { recursive: true }); fs.writeFileSync("config/ftmarkets.json", JSON.stringify({ secilen: good, duzeltme: cal, egitimFarki: out.egitimFarki }, null, 1));
console.log(JSON.stringify({ maç: out.maç, hesaplanan: out.hesaplanan, secilen: out.secilenPazarlar, sinav: out.sinav_secilenPazarlar, tum: out.sinav_tumPazarlar, taraf: out.sinav_sadeceTaraf }, null, 1));
