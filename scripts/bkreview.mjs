// Basketbol robotunun gecmis gun degerlendirmesi: her gun icin yalniz o gunden onceki maclarla tahmin, sonra skorla karsilastirma.
// Cizgi: Polymarket kapanmis etkinlikteki en cok islem goren toplam sayi cizgisi. Kural: canli robotla ayni (hiz 0,2, en az 0,65 eminlik).
import fs from "node:fs";
import { getText } from "../lib/sources.mjs";
import { PointsModel, pOver } from "../lib/basket.mjs";
const DATES = (process.env.DATES || "2026-11-07,2026-11-08").split(",");
const cache = JSON.parse(fs.readFileSync("docs/nbaresults.json", "utf8")), nick = n => String(n).trim().split(/\s+/).at(-1).toLowerCase();
const games = Object.entries(cache).filter(([k, g]) => k.startsWith("nba-") && g.hs + g.as > 100).map(([k, g]) => ({ slug: k, ...g, h: nick(g.h), a: nick(g.a), H: g.h, A: g.a })).sort((a, b) => a.day.localeCompare(b.day));
const lines = {};
for (let off = 0; off < 400; off += 100) {
  const list = JSON.parse(await getText(`https://gamma-api.polymarket.com/events?tag_slug=nba&closed=true&limit=100&offset=${off}&order=endDate&ascending=false`, 1));
  for (const e of list) { const m = /^nba-[a-z]+-[a-z]+-(\d{4}-\d{2}-\d{2})$/.exec(e.slug || ""); if (!m || !DATES.includes(m[1])) continue;
    const tl = (e.markets || []).filter(x => x.sportsMarketType === "totals" && Number.isFinite(Number(x.line))).sort((a, b) => (b.volumeNum || 0) - (a.volumeNum || 0));
    if (tl[0]) lines[e.slug] = { line: Number(tl[0].line), alt: tl.slice(1, 4).map(x => Number(x.line)) }; }
  if (!list.length || String(list.at(-1).endDate || "") < DATES[0]) break;
}
const out = {};
for (const D of DATES) {
  const M = new PointsModel({ mean: 112, home: 2, lr: 0.2 }), prev = games.filter(g => g.day < D);
  M.mean = prev.reduce((s, g) => s + g.hs + g.as, 0) / prev.length / 2;
  for (const g of prev) M.update(g.h, g.a, g.hs, g.as, g.day);
  out[D] = games.filter(g => g.day === D).map(g => { const p = M.predict(g.h, g.a, D), L = lines[g.slug]?.line, q = Number.isFinite(L) ? pOver(p, L) : null, conf = q === null ? null : Math.max(q, 1 - q), tot = g.hs + g.as;
    return { maç: `${g.H} – ${g.A}`, beklenen: +p.total.toFixed(1), çizgi: L ?? null, yön: q === null ? null : q >= .5 ? "Üst" : "Alt", eminlik: conf === null ? null : +conf.toFixed(3), seçim: conf !== null && conf >= 0.65, skor: `${g.hs}-${g.as}`, toplam: tot, sonuç: q === null || tot === L ? null : (tot > L) === (q >= .5) }; });
}
fs.writeFileSync("docs/bkreview.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
