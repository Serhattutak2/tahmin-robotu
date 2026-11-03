// Basketbol motoru: hucum/savunma puanlari, ev avantaji, dinlenme. Sayi yoksa yalniz kazanan Elo'su kullanilir.
const erf = x => { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.5 * a), r = 1 - t * Math.exp(-a * a - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return s * r; };
export const cdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
export class PointsModel {
  constructor({ lr = 0.06, mean = 80, home = 3 } = {}) { Object.assign(this, { lr, mean, home }); this.t = {}; this.n = 0; this.errM = 12; this.errT = 16; }
  team(x) { return (this.t[x] ||= { o: 0, d: 0, g: 0, last: null }); }
  rest(x, day) { const l = this.team(x).last; if (!l) return 0; const gap = (Date.parse(day) - Date.parse(l)) / 864e5; return gap <= 1 ? -1.5 : gap >= 3 ? 0.5 : 0; }
  predict(h, a, day) { const H = this.team(h), A = this.team(a), adj = this.rest(h, day) - this.rest(a, day), ph = this.mean + H.o - A.d + this.home / 2 + adj / 2, pa = this.mean + A.o - H.d - this.home / 2 - adj / 2; return { margin: ph - pa, total: ph + pa, games: Math.min(H.g, A.g), sdM: this.errM, sdT: this.errT }; }
  update(h, a, hs, as, day) { const p = this.predict(h, a, day), e1 = hs - (p.total + p.margin) / 2, e2 = as - (p.total - p.margin) / 2, H = this.team(h), A = this.team(a), lr = this.lr; H.o += lr * e1; A.d -= lr * e1; A.o += lr * e2; H.d -= lr * e2; this.mean += 0.002 * (e1 + e2) / 2; this.home += 0.002 * (e1 - e2); H.g++; A.g++; H.last = day; A.last = day; this.errM += 0.01 * (Math.abs(hs - as - p.margin) * 1.25 - this.errM); this.errT += 0.01 * (Math.abs(hs + as - p.total) * 1.25 - this.errT); this.n++; }
}
export const pSide = p => cdf(p.margin / p.sdM);
export const pOver = (p, line) => 1 - cdf((line - p.total) / p.sdT);
export const pCover = (p, line) => 1 - cdf((-line - p.margin) / p.sdM);
export function feedGame(g) { const nm = x => x?.name || x?.club?.name || x?.editorialName || x?.club?.editorialName, hs = Number(g.home?.score), as = Number(g.away?.score), h = nm(g.home), a = nm(g.away); if (!h || !a || !g.date) return null; return { day: String(g.date).slice(0, 10), home: h, away: a, hs, as, done: Number.isFinite(hs) && Number.isFinite(as) && hs + as > 0 }; }
export function nbaCsv(rows) { const m = new Map(); for (const r of rows) { const e = m.get(r.GAME_ID) || { day: String(r.GAME_DATE).slice(0, 10) }; if (/ vs\. /.test(r.MATCHUP)) { e.home = r.TEAM_NAME; e.hs = +r.PTS; } else { e.away = r.TEAM_NAME; e.as = +r.PTS; } m.set(r.GAME_ID, e); } return [...m.values()].filter(e => e.home && e.away && e.hs + e.as > 0).sort((a, b) => a.day.localeCompare(b.day)); }
