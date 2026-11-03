// Belirli gunlerde fiyat disiplini kurali. Sonuc yalniz karsilastirma icin kullanilir.
import fs from "node:fs";
import { devig, fdDate, num } from "../lib/engine.mjs";
import { FD_LEAGUES, EXTRA_LEAGUES, fdSeason, extraRows, mapLimit } from "../lib/sources.mjs";
const DAYS = (process.env.DAYS || "2026-11-01,2026-11-02").split(","), lab = ["MS 1", "MS X", "MS 2"];
const tri = (r, k) => { const v = [num(r[`${k}H`]), num(r[`${k}D`]), num(r[`${k}A`])]; return v.every(Number.isFinite) ? v : null; }, out = []; let seen = 0, withOdds = 0;
const eval1 = (r, league) => { const date = fdDate(r.Date); if (!DAYS.includes(date) || r.FTHG === "" || r.FTHG === undefined) return; seen++; const fairO = tri(r, "PS") || tri(r, "Avg"); if (!fairO) return; withOdds++; const fair = devig(fairO), hs = +r.FTHG, as = +r.FTAG, y = hs > as ? 0 : hs === as ? 1 : 2; for (const [name, e, cut, edge] of [["bet365", tri(r, "B365"), 1, .02], ["enYüksek", tri(r, "Max"), .96, .05]]) { if (!e) continue; let b = null; fair.forEach((p, i) => { const price = e[i] * cut; if (price >= 1.2 && price <= 3.2 && p * price - 1 >= edge && (!b || p * price > b.pp)) b = { i, pp: p * price, price, odd: e[i], p }; }); if (b) out.push({ date, league, match: `${r.HomeTeam} – ${r.AwayTeam}`, score: `${hs}-${as}`, kural: name, seçim: lab[b.i], oran: +b.odd.toFixed(2), hesapOranı: +b.price.toFixed(2), enAz: +((1 + edge) / b.p / cut).toFixed(2), tuttu: b.i === y, kar: +((b.i === y ? b.price - 1 : -1)).toFixed(2) }); } };
await mapLimit(Object.keys(FD_LEAGUES), 6, async c => { for (const r of await fdSeason("2627", c)) eval1(r, FD_LEAGUES[c]); });
await mapLimit(Object.keys(EXTRA_LEAGUES), 4, async c => { for (const r0 of await extraRows(c)) eval1({ ...r0 }, EXTRA_LEAGUES[c]); });
fs.writeFileSync("docs/days.json", JSON.stringify({ gün: DAYS, incelenen: seen, oranlı: withOdds, seçimler: out }, null, 1)); console.log(seen, withOdds, out.length);
