// Saf hesaplama: oran -> olasilik, Elo, deger karari. Ag erisimi yok.
export function devig(odds) {
  if (!odds.every(o => Number.isFinite(o) && o > 1)) return null;
  const inv = odds.map(o => 1 / o), sum = inv.reduce((a, b) => a + b, 0);
  return inv.map(v => v / sum);
}
export class Elo {
  constructor({ k = 20, home = 60, start = 1500 } = {}) { Object.assign(this, { k, home, start }); this.teams = new Map(); }
  get(t) { return this.teams.get(t) || { r: this.start, n: 0 }; }
  expected(h, a) { return 1 / (1 + 10 ** (-(this.get(h).r + this.home - this.get(a).r) / 400)); }
  games(h, a) { return Math.min(this.get(h).n, this.get(a).n); }
  update(h, a, hs, as) {
    const e = this.expected(h, a), res = hs > as ? 1 : hs === as ? 0.5 : 0;
    const margin = Math.log(Math.abs(hs - as) + 1) || 1, d = this.k * margin * (res - e);
    const A = this.get(h), B = this.get(a);
    this.teams.set(h, { r: A.r + d, n: A.n + 1 }); this.teams.set(a, { r: B.r - d, n: B.n + 1 });
  }
}
// Elo beklentisinden 1X2 (draw=true) ya da iki sonuclu (basketbol) olasilik.
export function eloProbs(e, draw = true) {
  if (!draw) return [e, 1 - e];
  const d = 0.3 * (1 - Math.abs(2 * e - 1) * 0.8);
  const h = Math.max(0.02, e - d / 2), a = Math.max(0.02, 1 - e - d / 2), s = h + d + a;
  return [h / s, d / s, a / s];
}
// fair: keskin/piyasa odds, entry: oynanacak oran. Uygun sonuc yoksa null.
export function decide({ fair, entry, model = null, labels, probs = null }, { weight = 0, minEdge, minOdds = 1.3, maxOdds = 99 }) {
  const market = probs || devig(fair);
  if (!market || entry.length !== market.length) return null;
  const w = model ? weight : 0;
  let best = null;
  market.forEach((m, i) => {
    const price = entry[i];
    if (!Number.isFinite(price) || price < minOdds || price > maxOdds) return;
    const p = (1 - w) * m + w * (model ? model[i] : 0), edge = p * price - 1;
    if (edge >= minEdge && (!best || edge > best.edge)) best = { index: i, label: labels?.[i], odds: price, probability: p, edge, minPlayableOdds: (1 + minEdge) / p };
  });
  return best;
}
export function normTeam(name) {
  return String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ı/g, "i")
    .replace(/\b(fc|cf|afc|sc|ac|sv|fk|sk|cd|ud|rc|ss|us|as|ssc|calcio|club|de|vfb|vfl|tsg|utd|united)\b/g, " ").replace(/[^a-z0-9]/g, "");
}
export function sameTeam(a, b) {
  const x = normTeam(a), y = normTeam(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.includes(s);
}
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(",").map(s => s.trim());
  return lines.slice(1).map(l => { const c = l.split(","); return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? "").trim()])); });
}
export function fdDate(v) {
  const p = String(v).split("/"); if (p.length !== 3) return null;
  const y = p[2].length === 2 ? `20${p[2]}` : p[2];
  return `${y}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
}
export const num = v => { const n = Number(v); return Number.isFinite(n) && n > 1 ? n : NaN; };
export function americanToDecimal(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const t = String(v).trim().toUpperCase();
  if (t === "EVEN" || t === "EV") return 2;
  const n = Number(t.replace("+", ""));
  if (!Number.isFinite(n) || n === 0) return NaN;
  return Math.round((n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)) * 100) / 100;
}
export function settle(pick, hs, as) {
  const r = pick.market === "ou25" ? (hs + as > 2.5 ? 0 : 1) : pick.sport === "basketball" ? (hs > as ? 0 : 1) : hs > as ? 0 : hs === as ? 1 : 2;
  const won = r === pick.index;
  return { status: won ? "won" : "lost", profit: won ? pick.odds - 1 : -1, score: `${hs}-${as}` };
}
export function summarize(ledger) {
  const done = ledger.filter(p => p.status === "won" || p.status === "lost");
  const profit = done.reduce((a, p) => a + p.profit, 0), won = done.filter(p => p.status === "won").length;
  return { picks: done.length, pending: ledger.filter(p => p.status === "pending").length, won, profit: +profit.toFixed(2),
    roi: done.length ? +(profit / done.length).toFixed(4) : null, hitRate: done.length ? +(won / done.length).toFixed(4) : null };
}
