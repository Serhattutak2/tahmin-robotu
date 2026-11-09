// Basketbol robotu modeli (basketbola ozel). Takim hucum/savunma gucu, lig ortalamasi, ev avantaji, dinlenme.
// Secenekler: lr (uyum hizi), meanRate (lig ortalamasi uyumu), cap (farki acilan maclarda hatanin sinirlanmasi),
// carry (yeni sezona gecen guc orani), venue (ev/deplasman ayri guc agirligi), rest (dinlenme etkileri).
import { cdf } from "./basket.mjs";
export class BModel {
  constructor(o = {}) { Object.assign(this, { lr: 0.2, meanRate: 0.002, cap: 0, carry: 1, venue: 0, rest: { b2b: -1.5, long: 0.5 }, mean: 104, home: 3 }, o); this.t = {}; this.errT = 18; this.errM = 13; this.season = null; }
  team(x) { return (this.t[x] ||= { o: 0, d: 0, oh: 0, dh: 0, oa: 0, da: 0, g: 0, last: null }); }
  newSeason(s) { if (this.season === s) return; if (this.season !== null) for (const T of Object.values(this.t)) { for (const k of ["o", "d", "oh", "dh", "oa", "da"]) T[k] *= this.carry; T.g = Math.round(T.g * this.carry); T.last = null; } this.season = s; }
  restAdj(x, day) { const l = this.team(x).last; if (!l) return 0; const gap = (Date.parse(day) - Date.parse(l)) / 864e5; return gap <= 1 ? this.rest.b2b : gap >= 3 ? this.rest.long : 0; }
  predict(h, a, day) { const H = this.team(h), A = this.team(a), v = this.venue, adj = this.restAdj(h, day) - this.restAdj(a, day);
    const ho = H.o + v * H.oh, hd = H.d + v * H.dh, ao = A.o + v * A.oa, ad = A.d + v * A.da;
    const ph = this.mean + ho - ad + this.home / 2 + adj / 2, pa = this.mean + ao - hd - this.home / 2 - adj / 2;
    return { margin: ph - pa, total: ph + pa, games: Math.min(H.g, A.g), sdM: this.errM, sdT: this.errT }; }
  update(h, a, hs, as, day) { const p = this.predict(h, a, day), H = this.team(h), A = this.team(a), lr = this.lr;
    let e1 = hs - (p.total + p.margin) / 2, e2 = as - (p.total - p.margin) / 2;
    if (this.cap) { const c = this.cap; e1 = Math.max(-c, Math.min(c, e1)); e2 = Math.max(-c, Math.min(c, e2)); }
    H.o += lr * e1; A.d -= lr * e1; A.o += lr * e2; H.d -= lr * e2;
    if (this.venue) { H.oh += lr * (e1 - (H.oh)) * 0.5; A.da -= lr * e1 * 0.5; A.oa += lr * e2 * 0.5; H.dh -= lr * e2 * 0.5; }
    this.mean += this.meanRate * (e1 + e2) / 2; this.home += 0.002 * (e1 - e2);
    H.g++; A.g++; H.last = day; A.last = day;
    this.errM += 0.01 * (Math.abs(hs - as - p.margin) * 1.25 - this.errM); this.errT += 0.01 * (Math.abs(hs + as - p.total) * 1.25 - this.errT); }
}
export const bOver = (p, line) => 1 - cdf((line - p.total) / p.sdT);
