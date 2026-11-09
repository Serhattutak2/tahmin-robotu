// Basketbol motoru, NBA kapanis ve acilis cizgileriyle sinav (2011-2022 arsivi, sportsbookreview).
// Handikap ve alt/ust standart -110 (1,91) varsayilir. Esik secim donemi (2014-2018) ile secilir, son 3 sezonda (2019-2021) sinanir.
import fs from "node:fs";
import { americanToDecimal } from "../lib/engine.mjs";
import { getText } from "../lib/sources.mjs";
import { PointsModel, pSide, pOver, pCover } from "../lib/basket.mjs";
const raw = JSON.parse(await getText("https://raw.githubusercontent.com/flancast90/sportsbookreview-scraper/main/data/nba_archive_10Y.json", 2));
const day = d => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
// Veri temizligi: bazi satirlarda handikap ile alt/ust yer degistirmis (ornek: handikap 217, toplam 3). Bunlar duzeltilir;
// isareti oranla celisen ya da mantiksiz cizgiler atilir.
const fix = (sp, tt, favH) => { let s = +sp, t = +tt; if (Math.abs(s) > 60 && Math.abs(t) < 40) [s, t] = [Math.abs(t) * (favH ? -1 : 1), Math.abs(s)]; if (!(Math.abs(s) <= 25) || (s !== 0 && (s < 0) !== favH)) s = NaN; if (!(t >= 170 && t <= 270)) t = NaN; return [s, t]; };
const games = raw.map(g => { const favH = g.home_close_ml < g.away_close_ml, [so, to] = fix(g.home_open_spread, g.open_over_under, favH), [sc, tc] = fix(g.home_close_spread, g.close_over_under, favH); return { season: g.season, day: day(g.date), h: g.home_team, a: g.away_team, hs: +g.home_final, as: +g.away_final, ml: [g.home_close_ml, g.away_close_ml], so, sc, to, tc }; })
  .filter(g => Number.isFinite(g.hs) && Number.isFinite(g.as) && g.hs + g.as > 100).sort((a, b) => a.day.localeCompare(b.day));
const M = new PointsModel({ mean: 104, home: 3, lr: 0.06 }), recs = [];
for (const g of games) {
  const p = M.predict(g.h, g.a, g.day);
  if (p.games >= 10) recs.push({ ...g, p: { ...p } });
  M.update(g.h, g.a, g.hs, g.as, g.day);
}
const D = 1.91, bets = [];
for (const r of recs) {
  const mg = r.hs - r.as, tot = r.hs + r.as;
  // Handikap: ev sahibi cizgisi s (ev -5 => ev 5 farkla kazanmali). Kapsama olasiligi pCover(p, s).
  for (const [when, s] of [["açılış", r.so], ["kapanış", r.sc]]) if (Number.isFinite(s)) { const ph = pCover(r.p, s), side = ph >= 0.5 ? "ev" : "dep", q = Math.max(ph, 1 - ph), x = mg + s; if (x !== 0) bets.push({ season: r.season, tür: "handikap", when, q, y: side === "ev" ? x > 0 : x < 0, o: D, move: when === "açılış" && Number.isFinite(r.sc) ? (side === "ev" ? r.so - r.sc : r.sc - r.so) : null }); }
  for (const [when, t] of [["açılış", r.to], ["kapanış", r.tc]]) if (Number.isFinite(t) && t > 150) { const po = pOver(r.p, t), side = po >= 0.5 ? "üst" : "alt", q = Math.max(po, 1 - po); if (tot !== t) bets.push({ season: r.season, tür: "alt/üst", when, q, y: side === "üst" ? tot > t : tot < t, o: D, move: when === "açılış" && Number.isFinite(r.tc) ? (side === "üst" ? r.tc - r.to : r.to - r.tc) : null }); }
  // Taraf (kapanis orani): olasilik x oran
  const o = r.ml.map(v => americanToDecimal(+v)); if (o.every(v => v > 1)) { const ph = pSide(r.p), pr = [ph, 1 - ph], ev = pr.map((v, i) => v * o[i] - 1), i = ev[0] > ev[1] ? 0 : 1; if (o[i] >= 1.3 && o[i] <= 5) bets.push({ season: r.season, tür: "taraf", when: "kapanış", q: ev[i] + 0.5, y: i === 0 ? mg > 0 : mg < 0, o: o[i] }); }
}
const st = l => { if (!l.length) return { seçim: 0 }; const v = l.map(b => b.y ? b.o - 1 : -1), pr = v.reduce((a, b) => a + b, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((a, b) => a + (b - roi) ** 2, 0) / l.length / l.length), mv = l.filter(b => b.move !== null && b.move !== undefined);
  return { seçim: l.length, tutan: l.filter(b => b.y).length, kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1), ...(mv.length ? { çizgiBizeGeldi: mv.filter(b => b.move > 0).length, çizgiTersGitti: mv.filter(b => b.move < 0).length } : {}) }; };
const out = { generatedAt: new Date().toISOString(), maç: games.length, tahminli: recs.length, sonuç: {} };
for (const tür of ["handikap", "alt/üst", "taraf"]) for (const when of ["açılış", "kapanış"]) {
  const L = bets.filter(b => b.tür === tür && b.when === when); if (!L.length) continue;
  const thrs = tür === "taraf" ? [0.52, 0.55, 0.58, 0.62] : [0.5, 0.53, 0.55, 0.58, 0.6];
  const sel = L.filter(b => b.season >= 2014 && b.season <= 2018), test = L.filter(b => b.season >= 2019);
  const grid = thrs.map(t => ({ eşik: t, seçim: st(sel.filter(b => b.q >= t)), sınav: st(test.filter(b => b.q >= t)) }));
  const best = grid.filter(g => g.seçim.seçim >= 200).sort((a, b) => b.seçim.getiri100 - a.seçim.getiri100)[0];
  out.sonuç[`${tür}|${when}`] = { seçilenEşik: best?.eşik, seçimDönemi: best?.seçim, son3Sezon: best?.sınav, sezon: Object.fromEntries([2019, 2020, 2021].map(s => [s, st(test.filter(b => b.season === s && b.q >= (best?.eşik ?? 1)))])), hepsi: grid };
}
fs.writeFileSync("docs/basket3.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.sonuç)) console.log(k, v.seçilenEşik, JSON.stringify(v.seçimDönemi), JSON.stringify(v.son3Sezon));
