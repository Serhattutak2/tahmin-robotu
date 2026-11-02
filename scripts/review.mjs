// Son 30 gun sinavi: motor agirliklarini pencere oncesiyle egitir, her maci oncesindeki veriyle tahmin eder,
// sonra sonuclarla karsilastirip ders cikarir. Ders ancak onceki yillarda da guclu kanit varsa kural olur.
import fs from "node:fs";
import { decide, devig, fdDate } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { x12Features, ouFeatures, fit, softmax, rps } from "../lib/stack.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, mapLimit } from "../lib/sources.mjs";
const now = process.env.REVIEW_NOW ? Date.parse(process.env.REVIEW_NOW) : Date.now(), day = t => new Date(t).toISOString().slice(0, 10);
const from = day(now - 30 * 864e5), to = day(now);
const cfg = JSON.parse(fs.readFileSync("config/strategy.json", "utf8"));
const files = await mapLimit(FD_SEASONS.flatMap(s => Object.keys(FD_LEAGUES).map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const data = [];
for (const c of Object.keys(FD_LEAGUES)) {
  const rows = files.filter(f => f?.rows && f.c === c).flatMap(f => f.rows.map(r => ({ ...r, season: f.s, code: c, date: fdDate(r.Date) }))).filter(r => r.date && r.date < to && r.HomeTeam && r.FTHG !== "" && Number.isFinite(+r.FTHG));
  for (const rec of walkLeague(rows)) {
    const o = oddsOf(rec.r); if (!o.fair || !o.entry) continue;
    const X = x12Features(rec, o.fair); if (!X) continue;
    const hs = +rec.r.FTHG, as = +rec.r.FTAG;
    data.push({ rec, o, X, y: hs > as ? 0 : hs === as ? 1 : 2, Xou: o.ouFair && o.ouEntry ? ouFeatures(rec, o.ouFair) : null, you: hs + as > 2.5 ? 0 : 1, season: rec.r.season, code: c, date: rec.r.date });
  }
}
data.sort((a, b) => a.date.localeCompare(b.date));
const train = set => ({ x: fit(set.map(d => ({ X: d.X, y: d.y })), 8), o: fit(set.filter(d => d.Xou).map(d => ({ X: d.Xou, y: d.you })), 3) });
const apply = (d, m) => { d.p = softmax(d.X, m.x); if (d.Xou) d.pou = softmax(d.Xou, m.o); };
const before = data.filter(d => d.date < from), windowRows = data.filter(d => d.date >= from);
const blind = train(before); windowRows.forEach(d => apply(d, blind));
// Gecmis kanit: her sezon yalniz onceki sezonlarla egitilir.
const histSeasons = ["2122", "2223", "2324", "2425", "2526", "2627"];
for (const s of histSeasons) { const past = before.filter(d => FD_SEASONS.indexOf(d.season) < FD_SEASONS.indexOf(s)), m = train(past); before.filter(d => d.season === s).forEach(d => apply(d, m)); }
const band = o => o < 2 ? "1,30-2,00" : o < 3 ? "2,00-3,00" : o < 4.5 ? "3,00-4,50" : "4,50+";
function bet(d, c = cfg) {
  if (!d.p) return null;
  const a = decide({ entry: d.o.entry, fair: d.o.fair, probs: d.p }, c), b = d.pou && decide({ entry: d.o.ouEntry, fair: d.o.ouFair, probs: d.pou }, c);
  const x = [a && { ...a, market: "1X2", res: d.y }, b && { ...b, market: "2,5 Alt/Üst", res: d.you }].filter(Boolean).sort((m, n) => n.edge - m.edge)[0];
  return x && { ...x, league: FD_LEAGUES[d.code], band: band(x.odds), pr: x.index === x.res ? x.odds - 1 : -1, d };
}
const sum = l => { if (!l.length) return { picks: 0 }; const pr = l.reduce((a, x) => a + x.pr, 0), roi = pr / l.length, se = Math.sqrt(l.reduce((a, x) => a + (x.pr - roi) ** 2, 0) / l.length / l.length); return { picks: l.length, hitRate: +(l.filter(x => x.pr > 0).length / l.length).toFixed(3), avgOdds: +(l.reduce((a, x) => a + x.odds, 0) / l.length).toFixed(2), profit: +pr.toFixed(1), roi: +roi.toFixed(3), z: se ? +(roi / se).toFixed(2) : 0 }; };
const group = (l, k) => Object.fromEntries(Object.entries(Object.groupBy(l, x => x[k])).map(([a, v]) => [a, sum(v)]));
const wb = windowRows.map(d => bet(d)).filter(Boolean), wide = windowRows.map(d => bet(d, { ...cfg, minEdge: 0.01 })).filter(Boolean), hist = before.map(d => bet(d)).filter(Boolean);
const av = f => windowRows.length ? +(windowRows.reduce((a, d) => a + f(d), 0) / windowRows.length).toFixed(4) : null;
const buckets = [[0, .2], [.2, .35], [.35, .5], [.5, .65], [.65, 1.01]].map(([a, z]) => { let n = 0, h = 0, sp = 0; for (const d of windowRows) d.p.forEach((p, i) => { if (p >= a && p < z) { n++; sp += p; if (i === d.y) h++; } }); return { aralik: `%${a * 100}-${Math.min(z, 1) * 100}`, n, beklenen: n ? +(sp / n).toFixed(3) : null, gercek: n ? +(h / n).toFixed(3) : null }; });
// Ders -> kural: bu ay zararli VE gecmiste z<=-3 ve en az 100 secim. Aksi halde yalniz gozlem.
const lessons = [], filters = [];
const dims = [["league", "Lig"], ["market", "Pazar"], ["band", "Oran aralığı"]];
for (const [k, name] of dims) for (const [v, m] of Object.entries(group(wb, k))) {
  if (m.profit >= 0) continue;
  const h = sum(hist.filter(x => x[k] === v));
  if (h.picks >= 100 && h.z <= -3) { filters.push({ key: k, value: v, reason: `Son 30 gün ${m.profit} birim, geçmiş ${h.picks} seçimde getiri %${(h.roi * 100).toFixed(1)}` }); lessons.push(`KURAL: ${name} "${v}" dışarıda bırakıldı. Bu ay ve geçmişte güçlü şekilde zarar ettirdi.`); }
  else if (m.picks >= 3) lessons.push(`Gözlem: ${name} "${v}" bu ay ${m.picks} seçimde ${m.profit} birim. Geçmiş kanıt yetersiz (${h.picks} seçim, getiri ${h.picks ? `%${(h.roi * 100).toFixed(1)}` : "–"}), kural yapılmadı.`);
}
const mRps = av(d => rps(d.p, d.y)), kRps = av(d => rps(devig(d.o.fair), d.y));
if (mRps !== null) lessons.unshift(mRps < kRps ? `Motor bu ay piyasadan biraz daha iyi tahmin etti (RPS ${mRps} / ${kRps}).` : `Motor bu ay piyasayı geçemedi (RPS ${mRps} / ${kRps}).`);
if (wb.length < 30) lessons.push(`Yalnızca ${wb.length} seçim var. Bir ay kesin sonuç için çok kısa.`);
const lab = ["MS 1", "MS X", "MS 2"], lab2 = ["2,5 Üst", "2,5 Alt"];
const row = x => ({ date: x.d.date, league: x.league, home: x.d.rec.r.HomeTeam, away: x.d.rec.r.AwayTeam, score: `${x.d.rec.r.FTHG}-${x.d.rec.r.FTAG}`, selection: (x.market === "1X2" ? lab : lab2)[x.index], odds: x.odds, probability: +x.probability.toFixed(3), won: x.pr > 0 });
const rep = { generatedAt: new Date(now).toISOString(), from, to, trainedBefore: from, matches: windowRows.length, sharp: windowRows.filter(d => d.o.sharp).length, strategy: cfg, accuracy: { motor: av(d => d.p.indexOf(Math.max(...d.p)) === d.y ? 1 : 0), piyasa: av(d => { const m = devig(d.o.fair); return m.indexOf(Math.max(...m)) === d.y ? 1 : 0; }) }, rps: { motor: mRps, piyasa: kRps }, picks: sum(wb), widerEdge1pct: sum(wide), byLeague: group(wb, "league"), byMarket: group(wb, "market"), byBand: group(wb, "band"), calibration: buckets, lessons, filters, rows: wb.map(row).reverse() };
fs.writeFileSync("docs/review.json", JSON.stringify(rep, null, 1));
fs.writeFileSync("config/filters.json", JSON.stringify(filters, null, 1));
console.log(JSON.stringify({ ...rep, rows: rep.rows.length, byLeague: undefined }, null, 1));
