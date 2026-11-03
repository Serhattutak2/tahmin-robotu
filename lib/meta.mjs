// Ders katmani: bir tavsiyenin tutup tutmadigini gecmis sonuclardan ogrenir. Oran tahmini: piyasadan turetilir.
import { FD_LEAGUES } from "./sources.mjs";
import { MARKETS } from "./markets.mjs";
import { FEATURES } from "./features.mjs";
const LEAGUES = Object.keys(FD_LEAGUES);
export const GROUP = k => ["MS1", "MSX", "MS2"].includes(k) ? 0 : ["1X", "X2", "12"].includes(k) ? 1 : ["U15", "U25", "U35", "KGV"].includes(k) ? 2 : ["A15", "A25", "A35", "KGY"].includes(k) ? 3 : ["EV05", "DEP05", "EV15", "DEP15", "HE1", "HD1"].includes(k) ? 4 : 5;
export const GROUP_NAMES = ["Maç sonucu", "Çifte şans", "Gol üst", "Gol alt", "Takım golü/fark", "İlk yarı"];
const lg = p => { const q = Math.min(Math.max(p, 1e-3), 1 - 1e-3); return Math.log(q / (1 - q)); };
const KEYS = MARKETS.map(m => m.key);
export const META_DIM = 5 + KEYS.length + LEAGUES.length + FEATURES.length;
export function metaX(key, pMath, pMarket, goals, code, z = null) {
  const x = Array(META_DIM).fill(0); x[0] = lg(pMath) / 2; x[1] = lg(pMarket) / 2; x[2] = lg(pMath) - lg(pMarket); x[3] = (goals[0] + goals[1] - 2.7) / 1.2; x[4] = Math.abs(goals[0] - goals[1]) / 1.2;
  x[5 + KEYS.indexOf(key)] = 1; const i = LEAGUES.indexOf(code), o = 5 + KEYS.length; if (i >= 0) x[o + i] = 1; if (z) z.forEach((v, k) => { x[o + LEAGUES.length + k] = v; }); return x;
}
export const estOdds = pMarket => +(1 / Math.max(pMarket * 1.06, 1e-3)).toFixed(2);
