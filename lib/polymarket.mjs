// Polymarket herkese acik fiyatlari (anahtar ve kredi yok). Fiyat, olasilik gibi okunur.
import { getText, mapLimit } from "./sources.mjs";
const G = "https://gamma-api.polymarket.com";
const J = s => { try { return JSON.parse(s); } catch { return []; } };
export function parseEvent(e) {
  const sport = (e.tags || []).some(t => /basketball/i.test(t.slug)) ? "basketball" : (e.tags || []).some(t => /soccer/i.test(t.slug)) ? "football" : null;
  const [a, b] = String(e.title || "").split(/\s+vs\.?\s+/i); if (!sport || !a || !b) return null;
  const out = { id: `pm-${e.slug}`, slug: e.slug, sport, a: a.trim(), b: b.trim(), league: (e.tags || []).map(t => t.label).find(l => l && !/sports|games|soccer|basketball/i.test(l)) || (sport === "football" ? "Futbol" : "Basketbol"), kickoff: e.endDate, moneyline: null, three: null, lines: [] };
  for (const m of e.markets || []) {
    if (m.closed || m.active === false) continue;
    const names = J(m.outcomes), prices = J(m.outcomePrices).map(Number); if (names.length !== 2 || !prices.every(p => p > 0 && p < 1)) continue;
    const t = m.sportsMarketType;
    if (sport === "football" && t === "moneyline") { const g = String(m.groupItemTitle || ""); out.three ||= {}; if (/^draw/i.test(g)) out.three.draw = prices[0]; else if (g.includes(out.a) || out.a.includes(g)) out.three.a = prices[0]; else out.three.b = prices[0]; continue; }
    if (t === "moneyline") { out.moneyline = { names, prices, id: m.id }; continue; }
    if (t === "totals" || t === "spreads" || t === "both_teams_to_score") out.lines.push({ id: m.id, type: t, line: Number(m.line), names, prices, q: m.question, vol: m.volumeNum || 0 });
  }
  return out;
}
export async function fetchGames(fromIso, toIso) {
  const seen = new Map(), add = list => { for (const e of Array.isArray(list) ? list : []) if (/\d{4}-\d{2}-\d{2}$/.test(e.slug || "") && !seen.has(e.slug)) seen.set(e.slug, e); };
  const urls = []; for (const off of [0, 100, 200, 300, 400]) urls.push(`${G}/events?tag_slug=games&closed=false&limit=100&offset=${off}&end_date_min=${fromIso}&end_date_max=${toIso}`);
  for (const tag of ["nba", "basketball", "ucl", "uel", "epl", "la-liga", "bundesliga", "ligue-1", "serie-a", "turkey"]) urls.push(`${G}/events?tag_slug=${tag}&closed=false&limit=100&end_date_min=${fromIso}&end_date_max=${toIso}`);
  await mapLimit(urls, 3, async u => add(JSON.parse(await getText(u, 2))));
  return [...seen.values()].map(parseEvent).filter(Boolean);
}
export const fetchMarket = async id => JSON.parse(await getText(`${G}/markets/${id}`, 2));
// Basketbol: gercek taraf, handikap ve toplam cizgileri.
export function basketLines(g) {
  const o = [], push = (id, label, price, idx, kind, line) => { if (price > 0.5 && price < 0.84) o.push({ key: `PM_${id}_${idx}`, pmId: id, pmIdx: idx, kind, line, label, p: price, odd: +(1 / price).toFixed(2) }); };
  if (g.moneyline) g.moneyline.names.forEach((n, i) => push(g.moneyline.id, `${n} kazanır`, g.moneyline.prices[i], i, "side"));
  for (const l of g.lines) l.names.forEach((n, i) => { if (l.type === "totals") push(l.id, `Toplam sayı ${String(l.line).replace(".", ",")} ${/over/i.test(n) ? "Üst" : "Alt"}`, l.prices[i], i, "total", l.line); else if (l.type === "spreads") { const signed = i === 0 ? l.line : -l.line; push(l.id, `${n} ${signed > 0 ? "+" : ""}${String(signed).replace(".", ",")} handikap`, l.prices[i], i, "spread", signed); } });
  return o.sort((a, b) => b.p - a.p);
}
export const threeWay = (g, homeIsA = true) => { const t = g.three; if (!t || !(t.a > 0 && t.b > 0 && t.draw > 0)) return null; const s = t.a + t.b + t.draw, h = homeIsA ? t.a : t.b, w = homeIsA ? t.b : t.a; return [h / s, t.draw / s, w / s]; };
