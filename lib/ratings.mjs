// Takim gucu modelleri: Elo, Pi-rating, Dixon-Coles (zaman agirlikli Poisson) ve sut temelli xG vekili.
import { Elo, eloProbs, num } from "./engine.mjs";
import { FeatureState } from "./features.mjs";
const fact = [1]; for (let i = 1; i < 16; i++) fact[i] = fact[i - 1] * i;
const pois = (l, k) => Math.exp(-l) * l ** k / fact[k];
export function scoreGrid(lh, la, rho = -0.08) {
  let h = 0, d = 0, a = 0, over = 0, total = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    let p = pois(lh, i) * pois(la, j);
    if (i === 0 && j === 0) p *= Math.max(0, 1 - lh * la * rho);
    else if (i === 0 && j === 1) p *= 1 + lh * rho;
    else if (i === 1 && j === 0) p *= 1 + la * rho;
    else if (i === 1 && j === 1) p *= 1 - rho;
    total += p; if (i > j) h += p; else if (i === j) d += p; else a += p; if (i + j > 2.5) over += p;
  }
  return { x12: [h / total, d / total, a / total], over: over / total, lh, la };
}
// Zaman agirlikli Poisson hucum/savunma cozumu (Maher/Dixon-Coles). Her takim icin onsel olarak ortalama eklenir.
export function fitPoisson(matches, today, { xi = 0.0019, window = 800, iters = 12, prior = 2 } = {}) {
  const T = Date.parse(today), rows = [];
  for (const m of matches) { const age = (T - m.t) / 864e5; if (age > 0 && age <= window) rows.push({ ...m, w: Math.exp(-xi * age) }); }
  if (rows.length < 30) return null;
  const teams = new Set(rows.flatMap(r => [r.h, r.a])), att = {}, def = {};
  for (const t of teams) { att[t] = 1; def[t] = 1; }
  let sw = 0, sh = 0, sa = 0; for (const r of rows) { sw += r.w; sh += r.w * r.gh; sa += r.w * r.ga; }
  const muH = Math.max(sh / sw, 0.3), muA = Math.max(sa / sw, 0.3);
  for (let it = 0; it < iters; it++) {
    const nA = {}, dA = {}, nD = {}, dD = {};
    for (const t of teams) { nA[t] = prior; dA[t] = prior; nD[t] = prior; dD[t] = prior; }
    for (const r of rows) {
      nA[r.h] += r.w * r.gh; dA[r.h] += r.w * muH * def[r.a]; nA[r.a] += r.w * r.ga; dA[r.a] += r.w * muA * def[r.h];
      nD[r.a] += r.w * r.gh; dD[r.a] += r.w * muH * att[r.h]; nD[r.h] += r.w * r.ga; dD[r.h] += r.w * muA * att[r.a];
    }
    for (const t of teams) { att[t] = nA[t] / dA[t]; def[t] = nD[t] / dD[t]; }
  }
  return { att, def, muH, muA };
}
export function predictPoisson(fit, h, a) {
  if (!fit || !(h in fit.att) || !(a in fit.att)) return null;
  return scoreGrid(Math.min(fit.muH * fit.att[h] * fit.def[a], 6), Math.min(fit.muA * fit.att[a] * fit.def[h], 6));
}
const psi = r => Math.sign(r) * (10 ** (Math.abs(r) / 3) - 1), psiInv = e => Math.sign(e) * 3 * Math.log10(1 + Math.abs(e));
export class Pi {
  constructor({ lambda = 0.035, gamma = 0.7 } = {}) { Object.assign(this, { lambda, gamma }); this.t = new Map(); }
  get(x) { return this.t.get(x) || { H: 0, A: 0 }; }
  diff(h, a) { return psi(this.get(h).H) - psi(this.get(a).A); }
  update(h, a, gh, ga) {
    const e = this.diff(h, a), err = (gh - ga) - e, s = psiInv(Math.abs(err)) * Math.sign(err), H = this.get(h), A = this.get(a);
    const dh = this.lambda * s, da = -this.lambda * s;
    this.t.set(h, { H: H.H + dh, A: H.A + dh * this.gamma }); this.t.set(a, { A: A.A + da, H: A.H + da * this.gamma });
  }
  probs(h, a) { return eloProbs(1 / (1 + Math.exp(-0.9 * this.diff(h, a)))); }
}
// Bir ligin tum maclarini kronolojik gezer; her mac icin YALNIZCA oncesindeki veriyle bilesen olasiliklari uretir.
// rows: {date, HomeTeam, AwayTeam, FTHG, FTAG, HST, AST, HS, AS, season, ...}; upcoming sonuc gerektirmez.
export function walkLeague(rows, upcoming = []) {
  const all = [...rows.map(r => ({ r, done: true })), ...upcoming.map(r => ({ r, done: false }))].sort((x, y) => x.r.date.localeCompare(y.r.date) || (y.done - x.done));
  const fs = new FeatureState(), elo = new Elo(), pi = new Pi(), goals = [], xgs = [], last = new Map(), form = new Map(), h2h = new Map(), out = [];
  let fitDate = null, fitG = null, fitX = null;
  const xg = (s, st) => { const a = Number(s), b = Number(st); return Number.isFinite(a) && Number.isFinite(b) && s !== "" ? 0.32 * b + 0.03 * Math.max(a - b, 0) : null; };
  for (const { r, done } of all) {
    const t = Date.parse(r.date), h = r.HomeTeam, a = r.AwayTeam;
    if (!fitDate || t - fitDate >= 6 * 864e5) { fitG = fitPoisson(goals, r.date); fitX = xgs.length >= 30 ? fitPoisson(xgs, r.date) : null; fitDate = t; }
    const dc = predictPoisson(fitG, h, a), dx = predictPoisson(fitX, h, a), n = elo.games(h, a);
    const rec = { r, done, games: n, elo: n >= 10 ? eloProbs(elo.expected(h, a)) : null, pi: n >= 10 ? pi.probs(h, a) : null, dc: n >= 10 ? dc : null, dx: n >= 10 ? dx : null,
      restH: last.has(h) ? Math.min((t - last.get(h)) / 864e5, 14) : 7, restA: last.has(a) ? Math.min((t - last.get(a)) / 864e5, 14) : 7, formH: (form.get(h) || []).slice(-5).join(""), formA: (form.get(a) || []).slice(-5).join(""), h2h: (h2h.get(`${h}|${a}`) || h2h.get(`${a}|${h}`) || []).slice(-5) };
    if (done) fs.rollSeason(r.season);
    const eh = elo.get(h).r - elo.get(a).r, restD = Math.max(-7, Math.min(7, rec.restH - rec.restA));
    rec.feats = fs.features(h, a, r.Referee, { elo: eh / 100, pi: pi.diff(h, a), dc: dc ? dc.lh - dc.la : 0, dx: dx ? dx.lh - dx.la : 0, rest: restD });
    out.push(rec);
    if (!done) continue;
    const gh = +r.FTHG, ga = +r.FTAG;
    fs.update(r, h, a, gh, ga);
    elo.update(h, a, gh, ga); pi.update(h, a, gh, ga); goals.push({ t, h, a, gh, ga });
    const xh = xg(r.HS, r.HST), xa = xg(r.AS, r.AST);
    xgs.push({ t, h, a, gh: xh ?? gh, ga: xa ?? ga });
    last.set(h, t); last.set(a, t);
    const push = (k, v) => { const f = form.get(k) || []; f.push(v); form.set(k, f.slice(-5)); };
    push(h, gh > ga ? "G" : gh === ga ? "B" : "M"); push(a, ga > gh ? "G" : gh === ga ? "B" : "M");
    const key = `${h}|${a}`, rk = `${a}|${h}`, list = h2h.get(key) || h2h.get(rk) || [];
    list.push(`${h} ${gh}-${ga} ${a}`); h2h.set(h2h.has(rk) ? rk : key, list.slice(-5));
  }
  return out;
}
export function oddsOf(r) {
  const tri = k => [num(r[`${k}H`]), num(r[`${k}D`]), num(r[`${k}A`])], ou = k => [num(r[`${k}>2.5`]), num(r[`${k}<2.5`])], ok = a => a.every(Number.isFinite);
  const pick = (...c) => c.find(ok) || null;
  return { fair: pick(tri("PS"), tri("Avg"), tri("BbAv")), sharp: ok(tri("PS")), entry: pick(tri("B365"), tri("Avg"), tri("BbAv")), avg: pick(tri("Avg")), max: pick(tri("Max")),
    close: pick(tri("PSC"), tri("AvgC")), ouFair: pick(ou("P"), ou("Avg"), ou("BbAv")), ouEntry: pick(ou("B365"), ou("Avg"), ou("BbAv")), ouClose: pick(ou("PC"), ou("AvgC")), ouAvg: pick(ou("Avg")) };
}
