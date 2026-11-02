// Beklenen gollerden her bahis pazarinin olasiligi. Oran gerektirmez.
const fact = [1]; for (let i = 1; i < 14; i++) fact[i] = fact[i - 1] * i;
const pois = (l, k) => Math.exp(-l) * l ** k / fact[k];
export const MARKETS = [
  ["MS1", "Ev sahibi kazanır (MS 1)", (h, a) => h > a], ["MSX", "Beraberlik (MS X)", (h, a) => h === a], ["MS2", "Deplasman kazanır (MS 2)", (h, a) => h < a],
  ["1X", "Ev sahibi kaybetmez (1X)", (h, a) => h >= a], ["X2", "Deplasman kaybetmez (X2)", (h, a) => h <= a], ["12", "Beraberlik olmaz (12)", (h, a) => h !== a],
  ["U15", "1,5 Üst", (h, a) => h + a > 1.5], ["A15", "1,5 Alt", (h, a) => h + a < 1.5], ["U25", "2,5 Üst", (h, a) => h + a > 2.5], ["A25", "2,5 Alt", (h, a) => h + a < 2.5], ["U35", "3,5 Üst", (h, a) => h + a > 3.5], ["A35", "3,5 Alt", (h, a) => h + a < 3.5],
  ["KGV", "Karşılıklı gol var", (h, a) => h > 0 && a > 0], ["KGY", "Karşılıklı gol yok", (h, a) => !(h > 0 && a > 0)],
  ["EV05", "Ev sahibi gol atar", h => h > 0], ["DEP05", "Deplasman gol atar", (h, a) => a > 0], ["EV15", "Ev sahibi 2+ gol atar", h => h > 1], ["DEP15", "Deplasman 2+ gol atar", (h, a) => a > 1],
  ["HE1", "Ev sahibi 2+ farkla kazanır", (h, a) => h - a >= 2], ["HD1", "Deplasman 2+ farkla kazanır", (h, a) => a - h >= 2],
  ["IY05", "İlk yarı 0,5 Üst", null, (h, a) => h + a > 0.5], ["IYA15", "İlk yarı 1,5 Alt", null, (h, a) => h + a < 1.5], ["IYX", "İlk yarı beraberlik", null, (h, a) => h === a], ["IY1", "İlk yarı ev sahibi önde", null, (h, a) => h > a], ["IY2", "İlk yarı deplasman önde", null, (h, a) => h < a],
].map(([key, label, ft, ht]) => ({ key, label, ft, ht, half: !!ht }));
export const byKey = Object.fromEntries(MARKETS.map(m => [m.key, m]));
function matrix(lh, la, rho) { const g = []; for (let i = 0; i < 13; i++) { g[i] = []; for (let j = 0; j < 13; j++) { let p = pois(lh, i) * pois(la, j); if (rho) { if (!i && !j) p *= Math.max(0, 1 - lh * la * rho); else if (!i && j === 1) p *= 1 + lh * rho; else if (i === 1 && !j) p *= 1 + la * rho; else if (i === 1 && j === 1) p *= 1 - rho; } g[i][j] = p; } } return g; }
export function marketProbs(lh, la, htShare = 0.44) {
  const ft = matrix(lh, la, -0.08), ht = matrix(lh * htShare, la * htShare, 0), out = {};
  for (const m of MARKETS) { const g = m.half ? ht : ft, f = m.half ? m.ht : m.ft; let p = 0, t = 0; for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { t += g[i][j]; if (f(i, j)) p += g[i][j]; } out[m.key] = p / t; }
  return out;
}
const logit = p => { const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return Math.log(q / (1 - q)); }, sig = v => 1 / (1 + Math.exp(-v));
export function fitCal(pairs, iters = 300) { let a = 0, b = 1; if (pairs.length < 200) return { a, b }; for (let it = 0; it < iters; it++) { let ga = 0, gb = 0; for (const [p, y] of pairs) { const x = logit(p), e = y - sig(a + b * x); ga += e; gb += e * x; } a += 0.5 * ga / pairs.length; b += 0.2 * gb / pairs.length; } return { a: +a.toFixed(4), b: +b.toFixed(4) }; }
export const applyCal = (p, c) => c ? sig(c.a + c.b * logit(p)) : p;
// Yalniz 1X2 oranindan beklenen golleri bulur (matematik verisi olmayan ligler icin).
export function impliedGoals(probs) { let best = [1.4, 1.1], err = 1e9; for (let lh = 0.3; lh <= 4; lh += 0.05) for (let la = 0.2; la <= 3.5; la += 0.05) { const g = matrix(lh, la, -0.08); let h = 0, d = 0, a = 0; for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { if (i > j) h += g[i][j]; else if (i === j) d += g[i][j]; else a += g[i][j]; } const e = (h - probs[0]) ** 2 + (d - probs[1]) ** 2 + (a - probs[2]) ** 2 + 0.002 * (lh + la - 2.7) ** 2; if (e < err) { err = e; best = [lh, la]; } } return best; }
export function outcome(m, gh, ga, hth, hta) { if (m.half) { if (hth === null || hta === null) return null; return m.ht(hth, hta) ? 1 : 0; } return m.ft(gh, ga) ? 1 : 0; }
// Tavsiye: en guvenilir pazari sec, en az orani 1,30 ve ustu olsun. Oyna=oran>=en az.
export function recommend(probs, cal, { margin = 0.05, minOdds = 1.2, exclude = [] } = {}) {
  return MARKETS.filter(m => !exclude.includes(m.key)).map(m => { const p = applyCal(probs[m.key], cal?.[m.key]); return { key: m.key, label: m.label, p, minPlay: +((1 + margin) / p).toFixed(2) }; }).filter(x => x.minPlay >= minOdds).sort((a, b) => b.p - a.p);
}
