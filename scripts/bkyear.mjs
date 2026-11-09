// Basketbol robotunun son 1 yil testi (Polymarket kapanmis NBA maclari: skor + en cok islem goren toplam sayi cizgisi).
// Canli kosullar: her sezona sifirdan, yalniz o gune kadarki maclar, lig ortalamasi o gune kadarki maclardan, hiz 0,2, en az 10 mac, eminlik >= 0,70.
// Not: acilis cizgisi yok; en cok islem goren cizgi kapanisa yakindir, bu yuzden test zorlastirilmis olur. Oran 1,91 varsayilir.
import fs from "node:fs";
import { getText } from "../lib/sources.mjs";
import { BModel, bOver } from "../lib/basket2.mjs";
const FROM = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), games = new Map(); let calls = 0;
for (let off = 0; off < 20000; off += 100) {
  let list; try { list = JSON.parse(await getText(`https://gamma-api.polymarket.com/events?tag_slug=nba&closed=true&limit=100&offset=${off}&order=endDate&ascending=false`, 2)); calls++; } catch (e) { console.log("hata", off, e.message); break; }
  for (const e of list) { const m = /^nba-[a-z]+-[a-z]+-(\d{4}-\d{2}-\d{2})$/.exec(e.slug || ""), sc = /^(\d+)-(\d+)$/.exec(String(e.score || "")), [a, b] = String(e.title || "").split(/\s+vs\.?\s+/i); if (!m || !sc || !a || !b) continue;
    const tl = (e.markets || []).filter(x => x.sportsMarketType === "totals" && Number.isFinite(Number(x.line))).sort((x, y) => (y.volumeNum || 0) - (x.volumeNum || 0))[0];
    games.set(e.slug, { day: m[1], h: a.trim().split(/\s+/).at(-1).toLowerCase(), a: b.trim().split(/\s+/).at(-1).toLowerCase(), hs: +sc[1], as: +sc[2], line: tl ? Number(tl.line) : null, title: e.title }); }
  if (!list.length || String(list.at(-1).endDate || "") < "2025-09-01") break;
}
const G = [...games.values()].filter(g => g.hs + g.as > 100).sort((a, b) => a.day.localeCompare(b.day));
const seasonOf = d => d >= "2026-08-01" ? 2026 : 2025, bets = [], all = [], LR = Number(process.env.LR || 0.2);
let M = null, cur = null, seasonGames = [];
for (const g of G) {
  const s = seasonOf(g.day); if (s !== cur) { cur = s; M = new BModel({ lr: LR, home: 2, mean: 112 }); seasonGames = []; }
  if (seasonGames.length >= 20) M.mean = seasonGames.reduce((x, y) => x + y.hs + y.as, 0) / seasonGames.length / 2;
  const p = M.predict(g.h, g.a, g.day), tot = g.hs + g.as;
  if (g.day >= FROM && p.games >= 10 && Number.isFinite(g.line) && g.line > 150 && tot !== g.line) { const q = bOver(p, g.line), c = Math.max(q, 1 - q), r = { day: g.day, maç: g.title, beklenen: +p.total.toFixed(1), çizgi: g.line, yön: q >= .5 ? "Üst" : "Alt", eminlik: +c.toFixed(3), toplam: tot, y: (tot > g.line) === (q >= .5) }; all.push(r); if (c >= 0.7) bets.push(r); }
  M.update(g.h, g.a, g.hs, g.as, g.day); seasonGames.push(g);
}
const st = l => { if (!l.length) return { seçim: 0 }; const v = l.map(b => b.y ? .91 : -1), pr = v.reduce((a, b) => a + b, 0), roi = pr / l.length, se = Math.sqrt(v.reduce((a, b) => a + (b - roi) ** 2, 0) / l.length / l.length); return { seçim: l.length, tutan: l.filter(b => b.y).length, kar: +pr.toFixed(1), getiri100: +(roi * 100).toFixed(1), alt100: +((roi - 1.96 * se) * 100).toFixed(1), üst100: +((roi + 1.96 * se) * 100).toFixed(1) }; };
const fade = t => st(all.filter(r => r.eminlik >= t).map(r => ({ ...r, y: !r.y })));
const out = { generatedAt: new Date().toISOString(), hız: LR, tersYön: Object.fromEntries([0.6, 0.65, 0.7].map(t => [t, fade(t)])), başlangıç: FROM, sorgu: calls, toplananMaç: G.length, çizgiliMaç: all.length, robot: st(bets), eşikler: Object.fromEntries([0.55, 0.6, 0.65, 0.7, 0.75].map(t => [t, st(all.filter(r => r.eminlik >= t))])), ay: Object.fromEntries(Object.entries(Object.groupBy(bets, r => r.day.slice(0, 7))).sort().map(([k, v]) => [k, st(v)])), sonSeçimler: bets.slice(-25) };
fs.writeFileSync(process.env.LR ? "docs/bkyear_lr" + LR + ".json" : "docs/bkyear.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, sonSeçimler: undefined }));
