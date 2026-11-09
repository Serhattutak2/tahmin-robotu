// Basketbol robotu gelistirme laboratuvari. Her fikir tek basina temel ayarin (hiz 0,2, esik 0,65) ustune eklenir.
// Ayar yalniz secim doneminde (2014-2018) secilir; gorulmemis donemde (2019-2021 sezonlari) denetlenir. Sonra secim doneminde
// iyilestiren fikirler birlestirilir ve yine gorulmemis donemde denetlenir. Standart oran 1,91, acilis cizgisi.
import fs from "node:fs";
import { getText } from "../lib/sources.mjs";
import { BModel, bOver } from "../lib/basket2.mjs";
const SRC = process.env.NBA_JSON ? fs.readFileSync(process.env.NBA_JSON, "utf8") : await getText("https://raw.githubusercontent.com/flancast90/sportsbookreview-scraper/main/data/nba_archive_10Y.json", 2);
const day = d => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
const fix = (sp, tt, favH) => { let s = +sp, t = +tt; if (Math.abs(s) > 60 && Math.abs(t) < 40) [s, t] = [Math.abs(t) * (favH ? -1 : 1), Math.abs(s)]; if (!(Math.abs(s) <= 25) || (s !== 0 && (s < 0) !== favH)) s = NaN; if (!(t >= 170 && t <= 270)) t = NaN; return [s, t]; };
const G = JSON.parse(SRC).map(g => { const favH = g.home_close_ml < g.away_close_ml, [, to] = fix(g.home_open_spread, g.open_over_under, favH), [, tc] = fix(g.home_close_spread, g.close_over_under, favH); return { season: g.season, day: day(g.date), h: g.home_team, a: g.away_team, hs: +g.home_final, as: +g.away_final, to, tc }; })
  .filter(g => Number.isFinite(g.hs) && g.hs + g.as > 100).sort((a, b) => a.day.localeCompare(b.day));
const D = 1.91;
function run(opts, thr = 0.65) { const M = new BModel(opts), out = [];
  for (const g of G) { M.newSeason(g.season); const p = M.predict(g.h, g.a, g.day);
    if (p.games >= 10 && Number.isFinite(g.to) && g.season >= 2014) { const q = bOver(p, g.to), tot = g.hs + g.as; if (Math.max(q, 1 - q) >= thr && tot !== g.to) out.push({ season: g.season, y: (tot > g.to) === (q >= .5), move: Number.isFinite(g.tc) ? (q >= .5 ? g.tc - g.to : g.to - g.tc) : null }); }
    M.update(g.h, g.a, g.hs, g.as, g.day); }
  return out; }
const st = l => { if (!l.length) return { seçim: 0 }; const v = l.map(b => b.y ? D - 1 : -1), pr = v.reduce((a, b) => a + b, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((a, b) => a + (b - roi) ** 2, 0) / l.length / l.length), mv = l.filter(b => b.move !== null);
  return { seçim: l.length, tutan: l.filter(b => b.y).length, kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1), çizgiBize: mv.filter(b => b.move > 0).length, çizgiTers: mv.filter(b => b.move < 0).length }; };
const grade = (opts, thr) => { const b = run(opts, thr); return { seçim: st(b.filter(x => x.season <= 2018)), sınav: st(b.filter(x => x.season >= 2019)), sezon: [2019, 2020, 2021].map(s => st(b.filter(x => x.season === s)).getiri100) }; };
const base = { lr: 0.2 };
const IDEAS = {
  "Lig ortalaması uyumu": [0.002, 0.005, 0.01, 0.02, 0.04].map(v => ({ meanRate: v })),
  "Sezonlar arası geçiş": [1, 0.75, 0.5, 0.25].map(v => ({ carry: v })),
  "Farkı açılan maç sınırı": [0, 20, 15, 12, 10].map(v => ({ cap: v })),
  "İç saha / deplasman ayrı güç": [0, 0.5, 1].map(v => ({ venue: v })),
  "Ayrıntılı dinlenme": [{ b2b: -1.5, long: 0.5 }, { b2b: -3, long: 0.5 }, { b2b: -1.5, long: 1.5 }, { b2b: 0, long: 0 }, { b2b: -3, long: 1.5 }].map(v => ({ rest: v })),
};
const out = { generatedAt: new Date().toISOString(), temel: { ayar: base, ...grade(base, 0.65) }, fikirler: {}, birleşik: null };
const keep = {};
for (const [name, list] of Object.entries(IDEAS)) {
  const g = list.map(v => ({ v, ...grade({ ...base, ...v }, 0.65) })), best = g.sort((a, b) => b.seçim.getiri100 - a.seçim.getiri100)[0];
  out.fikirler[name] = { seçilen: best.v, seçimDönemi: best.seçim, sınav: best.sınav, sezon: best.sezon, temelSeçim: out.temel.seçim.getiri100 };
  if (best.seçim.getiri100 > out.temel.seçim.getiri100 + 0.3) Object.assign(keep, best.v);
  console.log(name, JSON.stringify(best.v), "| seç", best.seçim.getiri100, best.seçim.seçim, "| sınav", JSON.stringify(best.sınav), best.sezon.join(" / "));
}
// Birlesik: secim doneminde iyilestiren fikirler + esik yeniden secilir
const combo = { ...base, ...keep }, ths = [0.6, 0.62, 0.65, 0.68, 0.7].map(t => ({ t, ...grade(combo, t) })).filter(x => x.seçim.seçim >= 300).sort((a, b) => b.seçim.getiri100 - a.seçim.getiri100);
out.birleşik = { ayar: combo, eşik: ths[0].t, seçimDönemi: ths[0].seçim, sınav: ths[0].sınav, sezon: ths[0].sezon };
console.log("TEMEL", JSON.stringify(out.temel.seçim), JSON.stringify(out.temel.sınav), out.temel.sezon.join(" / "));
console.log("BİRLEŞİK", JSON.stringify(combo), ths[0].t, JSON.stringify(ths[0].seçim), JSON.stringify(ths[0].sınav), ths[0].sezon.join(" / "));
fs.writeFileSync(process.env.OUT || "docs/basket5.json", JSON.stringify(out, null, 1));
