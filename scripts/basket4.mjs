// Basketbol arastirma laboratuvari: basketbola ozel fikirler NBA arsiviyle (2011-2022) sinanir.
// Yon ve esik yalniz secim doneminde (2014-2018) belirlenir; sonuc gorulmemis donemde (2019-2021 sezonlari) olculur. Standart oran 1,91.
import fs from "node:fs";
import { getText } from "../lib/sources.mjs";
import { PointsModel, pOver, pCover } from "../lib/basket.mjs";
const SRC = process.env.NBA_JSON ? fs.readFileSync(process.env.NBA_JSON, "utf8") : await getText("https://raw.githubusercontent.com/flancast90/sportsbookreview-scraper/main/data/nba_archive_10Y.json", 2);
const day = d => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
const fix = (sp, tt, favH) => { let s = +sp, t = +tt; if (Math.abs(s) > 60 && Math.abs(t) < 40) [s, t] = [Math.abs(t) * (favH ? -1 : 1), Math.abs(s)]; if (!(Math.abs(s) <= 25) || (s !== 0 && (s < 0) !== favH)) s = NaN; if (!(t >= 170 && t <= 270)) t = NaN; return [s, t]; };
const G = JSON.parse(SRC).map(g => { const favH = g.home_close_ml < g.away_close_ml, [so, to] = fix(g.home_open_spread, g.open_over_under, favH), [sc, tc] = fix(g.home_close_spread, g.close_over_under, favH); return { season: g.season, day: day(g.date), h: g.home_team, a: g.away_team, hs: +g.home_final, as: +g.away_final, so, sc, to, tc }; })
  .filter(g => Number.isFinite(g.hs) && g.hs + g.as > 100).sort((a, b) => a.day.localeCompare(b.day));
const D = 1.91, M = Object.fromEntries([0.03, 0.06, 0.1, 0.13, 0.16, 0.2].map(lr => [lr, new PointsModel({ mean: 104, home: 3, lr })]));
const T = {}, team = n => (T[n] ||= { last: null, hist: [], margins: [] }), first = {};
const recs = [];
for (const g of G) {
  first[g.season] ||= g.day; const H = team(g.h), A = team(g.a), dayN = (Date.parse(g.day) - Date.parse(first[g.season])) / 864e5;
  const b2b = x => x.last && (Date.parse(g.day) - Date.parse(x.last)) / 864e5 <= 1;
  const ov = x => x.hist.slice(-5), ovN = x => ov(x).filter(v => v > 0).length - ov(x).filter(v => v < 0).length;
  const pr = Object.fromEntries(Object.entries(M).map(([k, m]) => [k, m.predict(g.h, g.a, g.day)]));
  recs.push({ ...g, dayN, b2bH: b2b(H), b2bA: b2b(A), ovH: ovN(H), ovA: ovN(A), nH: H.hist.length, lastMH: H.margins.at(-1), lastMA: A.margins.at(-1), pr, mg: g.hs - g.as, tot: g.hs + g.as });
  for (const m of Object.values(M)) m.update(g.h, g.a, g.hs, g.as, g.day);
  if (Number.isFinite(g.tc)) { const v = Math.sign(g.hs + g.as - g.tc); H.hist.push(v); A.hist.push(v); }
  H.margins.push(g.hs - g.as); A.margins.push(g.as - g.hs); H.last = g.day; A.last = g.day;
}
const R = recs.filter(r => r.season >= 2012);
// Bahis yardimcilari: alt/ust ve handikap sonucu (push haric)
const tot = (r, line, over) => { if (!Number.isFinite(line) || r.tot === line) return null; return (r.tot > line) === over; };
const ats = (r, line, home) => { if (!Number.isFinite(line)) return null; const x = r.mg + line; if (x === 0) return null; return (x > 0) === home; };
const st = l => { l = l.filter(v => v !== null); if (!l.length) return { seçim: 0 }; const v = l.map(y => y ? D - 1 : -1), pr = v.reduce((a, b) => a + b, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((a, b) => a + (b - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(Boolean).length, kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const sel = r => r.season >= 2014 && r.season <= 2018, test = r => r.season >= 2019;
// Her kural: adaylar (param) -> r => sonuc (true/false/null) ya da undefined (bahis yok). En iyi param secim doneminde secilir.
const RULES = {
  "Erken alt/üst (mevcut kural)": [{ p: "lr .06, eşik .60" }].map(x => ({ ...x, f: r => { const p = r.pr[0.06]; if (p.games < 10 || !Number.isFinite(r.to)) return; const q = pOver(p, r.to); if (Math.max(q, 1 - q) < .6) return; return tot(r, r.to, q >= .5); } })),
  "Erken alt/üst, ayarlı motor": [0.03, 0.06, 0.1, 0.13, 0.16, 0.2].flatMap(lr => [.56, .58, .6, .62, .65].map(e => ({ p: `lr ${lr}, eşik ${e}`, f: r => { const p = r.pr[lr]; if (p.games < 10 || !Number.isFinite(r.to)) return; const q = pOver(p, r.to); if (Math.max(q, 1 - q) < e) return; return tot(r, r.to, q >= .5); } }))),
  "Erken alt/üst, iki hızlı motor ortalaması": [[0.06, 0.13], [0.1, 0.16], [0.06, 0.2]].flatMap(([x, y]) => [.58, .6, .62].map(e => ({ p: `lr ${x}+${y}, eşik ${e}`, f: r => { const a = r.pr[x], b = r.pr[y]; if (a.games < 10 || !Number.isFinite(r.to)) return; const q = (pOver(a, r.to) + pOver(b, r.to)) / 2; if (Math.max(q, 1 - q) < e) return; return tot(r, r.to, q >= .5); } }))),
  "Sezon başı alt/üst (Baryla 2007)": [14, 21, 30, 45].flatMap(n => ["alt", "üst"].flatMap(d => ["açılış", "kapanış"].map(w => ({ p: `ilk ${n} gün, ${d}, ${w}`, f: r => { if (r.dayN > n) return; return tot(r, w === "açılış" ? r.to : r.tc, d === "üst"); } })))),
  "Sezon başı + motor": [21, 30, 45].flatMap(n => [.55, .58, .6].map(e => ({ p: `ilk ${n} gün, eşik ${e}`, f: r => { if (r.dayN > n) return; const p = r.pr[0.06]; if (p.games < 3 || !Number.isFinite(r.to)) return; const q = pOver(p, r.to); if (Math.max(q, 1 - q) < e) return; return tot(r, r.to, q >= .5); } }))),
  "Yüksek çizgide alt": [225, 230, 235].map(t => ({ p: `açılış ≥ ${t}`, f: r => r.to >= t ? tot(r, r.to, false) : undefined })),
  "Art arda üst/alt sonrası ters yön": [3, 4].flatMap(k => ["açılış", "kapanış"].map(w => ({ p: `iki takım toplam ≥ ${k}, ${w}`, f: r => { if (r.nH < 5) return; const s = r.ovH + r.ovA; if (Math.abs(s) < k) return; return tot(r, w === "açılış" ? r.to : r.tc, s < 0); } }))),
  "Art arda maç yorgunluğu": ["alt", "üst"].flatMap(d => ["ikisi", "biri"].map(m => ({ p: `${m} yorgun, ${d}`, f: r => { const n = (r.b2bH ? 1 : 0) + (r.b2bA ? 1 : 0); if (m === "ikisi" ? n < 2 : n !== 1) return; return tot(r, r.to, d === "üst"); } }))),
  "Yorgun takıma karşı handikap": ["açılış", "kapanış"].map(w => ({ p: w, f: r => { if (r.b2bH === r.b2bA) return; const line = w === "açılış" ? r.so : r.sc; return ats(r, line, r.b2bA); } })),
  "Büyük farkla kazanan sonrası ters": [15, 20, 25].map(m => ({ p: `≥ ${m} fark`, f: r => { const h = r.lastMH >= m, a = r.lastMA >= m; if (h === a) return; return ats(r, r.sc, a); } })),
  "Ev sahibi büyük sürpriz (10+)": [8, 10, 12].map(n => ({ p: `ev +${n} ve üstü`, f: r => r.sc >= n ? ats(r, r.sc, true) : undefined })),
  "Motor handikap, açılış": [.56, .58, .6, .62].map(e => ({ p: `eşik ${e}`, f: r => { const p = r.pr[0.06]; if (p.games < 10 || !Number.isFinite(r.so)) return; const q = pCover(p, r.so); if (Math.max(q, 1 - q) < e) return; return ats(r, r.so, q >= .5); } })),
};
const out = { generatedAt: new Date().toISOString(), maç: R.length, kurallar: {} };
for (const [name, cands] of Object.entries(RULES)) {
  const graded = cands.map(c => { const s = st(R.filter(sel).map(r => c.f(r)).filter(v => v !== undefined)), t = R.filter(test), tl = t.map(r => c.f(r)).filter(v => v !== undefined); return { ...c, seçim: s, sınav: st(tl), sezon: Object.fromEntries([2019, 2020, 2021].map(y => [y, st(t.filter(r => r.season === y).map(r => c.f(r)).filter(v => v !== undefined))])) }; });
  const best = graded.filter(g => g.seçim.seçim >= 150).sort((a, b) => b.seçim.getiri100 - a.seçim.getiri100)[0];
  out.kurallar[name] = best ? { ayar: best.p, seçimDönemi: best.seçim, sınav: best.sınav, sezon: best.sezon } : null;
}
fs.writeFileSync(process.env.OUT || "docs/basket4.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.kurallar)) console.log(k, "|", v?.ayar, "| seç", JSON.stringify(v?.seçimDönemi), "| sınav", JSON.stringify(v?.sınav), "|", v && Object.values(v.sezon).map(s => s.getiri100).join(" / "));
