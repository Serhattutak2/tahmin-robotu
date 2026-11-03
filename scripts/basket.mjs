// Basketbol motoru sinavi. Puan modeli gecmisle ilerler; kar testi yalniz kapanmis Polymarket cizgileriyle ve her ay yalniz gecmis secimlerle ayarlanir.
import fs from "node:fs";
import { Elo, sameTeam, parseCsv } from "../lib/engine.mjs";
import { getText, mapLimit } from "../lib/sources.mjs";
import { PointsModel, pSide, pOver, pCover, feedGame, nbaCsv } from "../lib/basket.mjs";
const pm = JSON.parse(fs.readFileSync("data/pmhist.json", "utf8")).filter(g => g.sport === "basketball").sort((a, b) => a.end.localeCompare(b.end));
const feed = async (c, s) => { const r = JSON.parse(await getText(`https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/${c}/seasons/${c}${s}/games`, 2)); return (r.data || []).map(feedGame).filter(Boolean); };
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026], lg = {}, samples = {};
for (const c of ["E", "U"]) { const seasons = (await mapLimit(YEARS, 2, async y => await feed(c, y))).filter(Array.isArray); const all = seasons.flat().filter(g => g.done).sort((a, b) => a.day.localeCompare(b.day)); lg[c] = all; samples[c] = { maç: all.length, ilk: all[0]?.day, son: all.at(-1)?.day }; }
let nba = []; try { nba = nbaCsv(parseCsv(await getText("https://raw.githubusercontent.com/NocturneBear/NBA-Data-2010-2024/main/regular_season_totals_2010_2024.csv", 2))).filter(g => g.day >= "2017-10-01"); } catch (e) { samples.nbaHata = e.message; }
samples.N = { maç: nba.length, ilk: nba[0]?.day, son: nba.at(-1)?.day };
// 1) Tahmin kalitesi: her mac oncesindeki veriyle, yillara gore.
function walk(games, mean, home) { const m = new PointsModel({ mean, home }), rows = []; for (const g of games) { const p = m.predict(g.home, g.away, g.day); if (p.games >= 8) rows.push({ day: g.day, p, ...g }); m.update(g.home, g.away, g.hs, g.as, g.day); } return { m, rows }; }
const quality = rows => { const by = {}; for (const r of rows) { const y = r.day.slice(0, 4), b = (by[y] ||= { maç: 0, taraf: 0, farkHata: 0, toplamHata: 0 }); b.maç++; if ((r.p.margin > 0) === (r.hs > r.as)) b.taraf++; b.farkHata += Math.abs(r.hs - r.as - r.p.margin); b.toplamHata += Math.abs(r.hs + r.as - r.p.total); } for (const b of Object.values(by)) { b.tarafİsabet = +(b.taraf / b.maç).toFixed(3); b.farkHata = +(b.farkHata / b.maç).toFixed(1); b.toplamHata = +(b.toplamHata / b.maç).toFixed(1); delete b.taraf; } return by; };
const models = { E: walk(lg.E, 80, 3), U: walk(lg.U, 80, 3), N: walk(nba, 112, 2.5) };
// 2) Polymarket satirlari: Avrupa icin puan modeli, NBA icin kazanan Elo'su (2024 sonrasi sayi yok).
const leagueOf = s => /^bkeuroleague|^bkel-|^el-/.test(s) ? "E" : /^bkeurocup/.test(s) ? "U" : /^nba/.test(s) ? "N" : null;
const rowsOut = [], nbaElo = new Elo({ k: 18, home: 0 }), played = { E: lg.E, U: lg.U };
for (const g of pm) {
  const L = leagueOf(g.slug); if (!L) continue; const [x, y] = g.names; const day = g.end.slice(0, 10);
  if (L === "N") { if (nbaElo.games(x, y) >= 8) rowsOut.push({ day, L, opts: [{ k: "taraf", q: nbaElo.expected(x, y), pr: g.p, won: g.win === 0 }, { k: "taraf", q: 1 - nbaElo.expected(x, y), pr: 1 - g.p, won: g.win === 1 }] }); nbaElo.update(x, y, g.win === 0 ? 1 : 0, g.win === 0 ? 0 : 1); continue; }
  const m = new PointsModel(), hist = played[L].filter(h => h.day < day); for (const h of hist) m.update(h.home, h.away, h.hs, h.as, h.day);
  const f = played[L].find(h => Math.abs(Date.parse(h.day) - Date.parse(day)) <= 864e5 && ((sameTeam(h.home, x) && sameTeam(h.away, y)) || (sameTeam(h.home, y) && sameTeam(h.away, x)))); if (!f) continue;
  const p = m.predict(f.home, f.away, f.day); if (p.games < 5) continue; const xHome = sameTeam(f.home, x), sx = xHome ? pSide(p) : 1 - pSide(p), opts = [{ k: "taraf", q: sx, pr: g.p, won: g.win === 0 }, { k: "taraf", q: 1 - sx, pr: 1 - g.p, won: g.win === 1 }];
  for (const l of g.lines) { if (l.type === "totals") { const q = pOver(p, l.line); opts.push({ k: "toplam", q, pr: l.p, won: l.won === 1 }, { k: "toplam", q: 1 - q, pr: 1 - l.p, won: l.won === 0 }); } else if (l.type === "spreads") { const q = pCover(p, xHome ? l.line : -l.line); const qx = xHome ? q : 1 - pCover(p, l.line); opts.push({ k: "handikap", q: qx, pr: l.p, won: l.won === 1 }, { k: "handikap", q: 1 - qx, pr: 1 - l.p, won: l.won === 0 }); } }
  rowsOut.push({ day, L, opts });
}
// 3) Ileri dogru ayar: her ay, yalniz onceki aylarin satirlariyla agirlik ve esik.
const GRID = []; for (const w of [.1, .2, .35, .5]) for (const e of [.03, .05, .08, .12]) GRID.push({ w, e });
const betsOf = (rows, c) => { const out = []; for (const r of rows) { let b = null; for (const o of r.opts) { if (!(o.pr > 0.1 && o.pr < 0.84)) continue; const odd = 1 / o.pr, p = c.w * o.q + (1 - c.w) * o.pr, ev = p * odd - 1; if (odd >= 1.2 && ev >= c.e && (!b || ev > b.ev)) b = { ...o, odd, ev }; } if (b) out.push({ v: b.won ? b.odd - 1 : -1, odd: b.odd, k: b.k, L: r.L, day: r.day }); } return out; };
const stat = l => { if (!l.length) return { seçim: 0 }; const pr = l.reduce((a, x) => a + x.v, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + (x.v - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(x => x.v > 0).length, ortalamaOran: +(l.reduce((a, x) => a + x.odd, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri: +roi.toFixed(4), alt: +(roi - 1.96 * se).toFixed(3), üst: +(roi + 1.96 * se).toFixed(3) }; };
const months = [...new Set(rowsOut.map(r => r.day.slice(0, 7)))].sort(), wf = [], chosen = [];
for (const mo of months) { const past = rowsOut.filter(r => r.day.slice(0, 7) < mo); const best = past.length < 150 ? null : GRID.map(c => ({ c, s: stat(betsOf(past, c)) })).filter(x => x.s.seçim >= 40).sort((a, b) => b.s.getiri - a.s.getiri)[0]; if (!best || best.s.getiri <= 0) { chosen.push({ ay: mo, ayar: null }); continue; } chosen.push({ ay: mo, ayar: best.c }); wf.push(...betsOf(rowsOut.filter(r => r.day.startsWith(mo)), best.c)); }
const group = (l, f) => Object.fromEntries(Object.entries(Object.groupBy(l, f)).map(([k, v]) => [k, stat(v)]));
const finalC = chosen.filter(x => x.ayar).at(-1)?.ayar || null;
const report = { generatedAt: new Date().toISOString(), veri: samples, kalite: { EuroLeague: quality(models.E.rows), EuroCup: quality(models.U.rows), NBA: quality(models.N.rows) }, fiyatSatırı: rowsOut.length, ilerleyenSınav: stat(wf), lig: group(wf, x => x.L), tür: group(wf, x => x.k), ay: group(wf, x => x.day.slice(0, 7)), ayarlar: chosen, sonAyar: finalC };
fs.writeFileSync("docs/basket.json", JSON.stringify(report, null, 1));
const snap = m => ({ mean: m.mean, home: m.home, errM: m.errM, errT: m.errT, t: m.t });
fs.writeFileSync("config/basket.json", JSON.stringify({ generatedAt: report.generatedAt, rule: finalC, proven: report.ilerleyenSınav.alt > 0 && report.ilerleyenSınav.seçim >= 300, E: snap(models.E.m), U: snap(models.U.m), nbaElo: Object.fromEntries(nbaElo.teams) }));
console.log(JSON.stringify({ ...report, ayarlar: undefined, ay: undefined }));
