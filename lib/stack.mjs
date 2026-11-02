// Bilesen olasiliklarini gecmis sonuclara gore agirliklandiran koşullu logit. Baslangic: yalniz piyasa.
import { devig } from "./engine.mjs";
const L = p => Math.log(Math.max(p, 1e-4));
export const FEATURE_NAMES = ["piyasa", "elo", "pi", "dixonColes", "xGvekili", "beraberlik", "evSahibi", "dinlenme"];
export function x12Features(rec, fair) {
  const m = devig(fair); if (!m || !rec.elo || !rec.pi || !rec.dc) return null;
  const dx = (rec.dx || rec.dc).x12, rest = Math.max(-7, Math.min(7, rec.restH - rec.restA)) / 7;
  return [0, 1, 2].map(k => [L(m[k]), L(rec.elo[k]), L(rec.pi[k]), L(rec.dc.x12[k]), L(dx[k]), k === 1 ? 1 : 0, k === 0 ? 1 : 0, k === 0 ? rest : k === 2 ? -rest : 0]);
}
export function ouFeatures(rec, fair) {
  const m = devig(fair); if (!m || !rec.dc) return null;
  const o = (rec.dx || rec.dc).over, feat = p => [L(p[0]), L(p[1]), L(p[2])];
  return [feat([m[0], rec.dc.over, o]), feat([m[1], 1 - rec.dc.over, 1 - o])];
}
export function softmax(X, b) {
  const s = X.map(x => x.reduce((a, v, i) => a + v * b[i], 0)), mx = Math.max(...s), e = s.map(v => Math.exp(v - mx)), t = e.reduce((a, v) => a + v);
  return e.map(v => v / t);
}
export function fit(data, dim, { iters = 250, lr = 0.25, l2 = 0.002 } = {}) {
  const prior = Array(dim).fill(0); prior[0] = 1; const b = [...prior];
  if (!data.length) return b;
  for (let it = 0; it < iters; it++) {
    const g = Array(dim).fill(0);
    for (const { X, y } of data) { const p = softmax(X, b); for (let k = 0; k < X.length; k++) { const d = (k === y ? 1 : 0) - p[k]; for (let i = 0; i < dim; i++) g[i] += d * X[k][i]; } }
    for (let i = 0; i < dim; i++) b[i] += lr * (g[i] / data.length - l2 * (b[i] - prior[i]));
  }
  return b.map(v => +v.toFixed(5));
}
export function rps(p, y) { let c = 0, o = 0, s = 0; for (let k = 0; k < p.length - 1; k++) { c += p[k]; o += k === y ? 1 : 0; s += (c - o) ** 2; } return s / (p.length - 1); }
export const logLoss = (p, y) => -Math.log(Math.max(p[y], 1e-9));
