// Voleybol motoru sinavi (Polymarket): her mac icin baslamadan 2 saat once fiyat (mac kazanani, set handikabi, toplam set) ve sonuc.
// Kurallar zaman sirasina gore ilk %60'ta secilir, son %40'ta sinanir. Kar Polymarket fiyatiyla ve bahis sitesi orani (yaklasik %4,5 dusuk) ile.
import fs from "node:fs";
import { getText, mapLimit } from "../lib/sources.mjs";
const G = "https://gamma-api.polymarket.com", J = s => { try { return JSON.parse(s); } catch { return []; } }, ev = [];
for (let off = 0; off < 5000; off += 100) { const l = JSON.parse(await getText(`${G}/events?tag_slug=volleyball&closed=true&limit=100&offset=${off}&order=endDate&ascending=false`, 2)); ev.push(...l); if (l.length < 100) break; }
async function price(token, end) { try { const r = JSON.parse(await getText(`https://clob.polymarket.com/prices-history?market=${token}&startTs=${end - 36 * 3600}&endTs=${end}&fidelity=60`, 2)); const h = r?.history || []; return h.length ? h.at(-1).p : null; } catch { return null; } }
const games = [], dbg = { n: 0, start: 0, nullPrice: 0, okPrice: 0, alanlar: null };
dbg.alanlar = ev[0] ? { e: Object.keys(ev[0]).filter(k => /time|date/i.test(k)), m: Object.keys(ev[0].markets?.[0] || {}).filter(k => /time|date/i.test(k)), örnek: (ev[0].markets || []).map(m => m.gameStartTime).find(Boolean) } : null;
await mapLimit(ev.filter(e => /\d{4}-\d{2}-\d{2}$/.test(e.slug || "")), 4, async e => {
  const [a, b] = String(e.title || "").split(/\s+vs\.?\s+/i); if (!a || !b) return; const gs = (e.markets || []).map(m => m.gameStartTime).find(Boolean) || e.startTime || e.eventStartTime, start = gs ? Date.parse(String(gs).replace(" ", "T").replace(/\+00$/, "Z")) : Date.parse(e.endDate); dbg.start += gs ? 1 : 0; dbg.n++; const end = Math.floor(start / 1000) - 2 * 3600, g = { slug: e.slug, end: new Date(start).toISOString(), league: e.slug.split("-")[0], a: a.trim(), b: b.trim(), m: [] };
  for (const m of e.markets || []) { const t = m.sportsMarketType; if (!["moneyline", "spreads", "totals"].includes(t)) continue; const tok = J(m.clobTokenIds), fin = J(m.outcomePrices).map(Number), names = J(m.outcomes); if (tok.length !== 2 || fin.length !== 2) continue; const win = fin[0] > 0.9 ? 0 : fin[1] > 0.9 ? 1 : null; if (win === null) continue; const p = await price(tok[0], end); if (!(p > 0.02 && p < 0.98)) { dbg.nullPrice++; continue; } dbg.okPrice++; g.m.push({ t, line: m.line ?? null, names, p, win, id: m.id }); }
  if (g.m.length) games.push(g);
});
games.sort((x, y) => x.end.localeCompare(y.end));
fs.mkdirSync("data", { recursive: true }); fs.writeFileSync("data/vbhist.json", JSON.stringify(games));
// Elo (mac kazanani sonucundan), zaman sirasiyla, mac oncesi deger.
const R = {}, el = n => R[n] ?? 1500; for (const g of games) { const ml = g.m.find(x => x.t === "moneyline"); g.elo = 1 / (1 + 10 ** ((el(g.b) - el(g.a)) / 400)); g.n = Math.min((R[g.a + "#"] || 0), (R[g.b + "#"] || 0)); if (ml) { const s = ml.win === 0 ? 1 : 0, d = 24 * (s - g.elo); R[g.a] = el(g.a) + d; R[g.b] = el(g.b) - d; R[g.a + "#"] = (R[g.a + "#"] || 0) + 1; R[g.b + "#"] = (R[g.b + "#"] || 0) + 1; } }
const cut = Math.floor(games.length * 0.6), L = games.slice(0, cut), T = games.slice(cut);
const opts = g => g.m.flatMap(x => [{ t: x.t, p: x.p, y: x.win === 0, side: 0, x }, { t: x.t, p: 1 - x.p, y: x.win === 1, side: 1, x }]);
const st = (l, k = 1) => { if (!l.length) return { seçim: 0 }; const v = l.map(b => b.y ? b.o * k - 1 : -1), pr = v.reduce((a, b) => a + b, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((a, b) => a + (b - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(b => b.y).length, ortOran: +(l.reduce((a, b) => a + b.o * k, 0) / l.length).toFixed(2), kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const RULES = {};
for (const types of [["moneyline"], ["spreads"], ["totals"], ["moneyline", "spreads", "totals"]]) for (const [lo, hi] of [[1.3, 1.7], [1.3, 2.0], [1.5, 2.2], [1.7, 2.5]])
  RULES[`Favori takibi | ${types.join("+")} | ${lo}-${hi}`] = g => { const o = opts(g).filter(x => types.includes(x.t) && x.p > 0.5).sort((a, b) => b.p - a.p)[0]; if (!o) return null; const odd = 1 / o.p; return odd >= lo && odd <= hi ? { o: odd, y: o.y } : null; };
for (const w of [0.3, 0.5]) for (const e of [0.02, 0.05, 0.1]) RULES[`Elo + piyasa | ağırlık ${w} | eşik ${e}`] = g => { const ml = g.m.find(x => x.t === "moneyline"); if (!ml || g.n < 5) return null; const q = w * g.elo + (1 - w) * ml.p; const c = [[q, ml.p, ml.win === 0], [1 - q, 1 - ml.p, ml.win === 1]].map(([qq, pp, y]) => ({ ev: qq / pp - 1, o: 1 / pp, y })).filter(x => x.o >= 1.3 && x.o <= 3.5).sort((a, b) => b.ev - a.ev)[0]; return c && c.ev >= e ? { o: c.o, y: c.y } : null; };
const res = Object.entries(RULES).map(([k, f]) => { const l = L.map(f).filter(Boolean), t = T.map(f).filter(Boolean); return { kural: k, öğrenme: st(l), sınav: st(t), sınavSite: st(t, 0.955) }; });
const best = res.filter(r => r.öğrenme.seçim >= 40).sort((a, b) => b.öğrenme.getiri100 - a.öğrenme.getiri100);
const out = { generatedAt: new Date().toISOString(), dbg, maç: games.length, öğrenmeMaç: L.length, sınavMaç: T.length, ayrım: T[0]?.end, seçilen: best[0], hepsi: best, lig: Object.fromEntries(Object.entries(Object.groupBy(games, g => g.league)).map(([k, v]) => [k, v.length])) };
fs.writeFileSync("docs/vbtest.json", JSON.stringify(out, null, 1));
console.log("maç", games.length, "ayrım", out.ayrım, JSON.stringify(dbg)); for (const r of best.slice(0, 12)) console.log(r.kural, "| öğrenme", r.öğrenme.kar, r.öğrenme.seçim, r.öğrenme.getiri100, "| SINAV pm", JSON.stringify(r.sınav), "| site", r.sınavSite.kar);
