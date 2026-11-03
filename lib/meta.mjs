// Ders katmani: bir tavsiyenin tutup tutmadigini gecmis sonuclardan ogrenir. Oran tahmini: piyasadan turetilir.
import { ALL_LEAGUES } from "./sources.mjs";
import { MARKETS } from "./markets.mjs";
import { FEATURES } from "./features.mjs";
const LEAGUES = Object.keys(ALL_LEAGUES);
export const GROUP = k => ["MS1", "MSX", "MS2"].includes(k) ? 0 : ["1X", "X2", "12"].includes(k) ? 1 : ["U15", "U25", "U35", "KGV"].includes(k) ? 2 : ["A15", "A25", "A35", "KGY"].includes(k) ? 3 : ["EV05", "DEP05", "EV15", "DEP15", "HE1", "HD1"].includes(k) ? 4 : 5;
export const GROUP_NAMES = ["Maç sonucu", "Çifte şans", "Gol üst", "Gol alt", "Takım golü/fark", "İlk yarı"];
const lg = p => { const q = Math.min(Math.max(p, 1e-3), 1 - 1e-3); return Math.log(q / (1 - q)); };
const KEYS = MARKETS.map(m => m.key);
export const META_DIM = 5 + KEYS.length + LEAGUES.length + FEATURES.length;
export function metaX(key, pMath, pMarket, goals, code, z = null) {
  const x = Array(META_DIM).fill(0); x[0] = lg(pMath) / 2; x[1] = lg(pMarket) / 2; x[2] = lg(pMath) - lg(pMarket); x[3] = (goals[0] + goals[1] - 2.7) / 1.2; x[4] = Math.abs(goals[0] - goals[1]) / 1.2;
  x[5 + KEYS.indexOf(key)] = 1; const i = LEAGUES.indexOf(code), o = 5 + KEYS.length; if (i >= 0) x[o + i] = 1; if (z) z.forEach((v, k) => { x[o + LEAGUES.length + k] = v; }); return x;
}
// Robotun oran tahmini: piyasa olasiligi + pazar turune gore bahis sirketi payi. Birlesik ve az oynanan pazarlarda pay yuksektir.
const COMBO = /^(1X|X2|12|MS1|MS2|KGV|KGY).+/, RARE = new Set(["EV05", "DEP05", "EV15", "DEP15", "HE1", "HD1", "EVA25", "DEPA25", "EV0", "DEP0", "U05", "A45", "U45"]);
export const estOdds = (pMarket, key = "") => +(1 / Math.max(pMarket * (COMBO.test(key) && key.length > 2 ? 1.1 : RARE.has(key) || key.startsWith("IY") ? 1.08 : 1.06), 1e-3)).toFixed(2);
