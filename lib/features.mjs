// Her mac icin, yalniz oncesindeki maclardan parametre cikarir. Bilinmeyen deger 0 kalir (ortalama).
export const GROUPS = {
  "Takım gücü": ["eloFark", "piFark", "golModeliFark", "xgModeliFark"],
  "Sezon istatistiği": ["sezonPuanFark", "sezonAverajFark", "sezonSiraFark"],
  "Form": ["form5Fark", "form10AverajFark"],
  "İç/dış saha": ["sahaPuanFark", "sahaGolFark"],
  "Şut ve korner": ["isabetliSutFark", "yenenIsabetliSutFark", "toplamSutFark", "kornerFark"],
  "Disiplin": ["faulFark", "kartFark"],
  "Dinlenme": ["dinlenmeFark"],
  "Karşılıklı geçmiş": ["karsilikliPuan"],
  "Lig": ["ligEvKazanma", "ligBeraberlik", "ligGol"],
  "Hakem": ["hakemEvKazanma", "hakemGol", "hakemKart"],
};
export const FEATURES = Object.values(GROUPS).flat();
const n = v => { const x = Number(v); return v === "" || v === undefined || !Number.isFinite(x) ? null : x; };
export class FeatureState {
  constructor() { this.t = new Map(); this.league = []; this.ref = new Map(); this.h2h = new Map(); this.season = null; }
  team(x) { if (!this.t.has(x)) this.t.set(x, { g: 0, pts: 0, gd: 0, hg: 0, hp: 0, hgf: 0, ag: 0, ap: 0, agf: 0, last: [], sot: 2 + 2, sotA: 4, shots: 12, corners: 5, fouls: 12, cards: 2 }); return this.t.get(x); }
  rollSeason(s) { if (s && s !== this.season) { this.season = s; for (const v of this.t.values()) Object.assign(v, { g: 0, pts: 0, gd: 0, hg: 0, hp: 0, hgf: 0, ag: 0, ap: 0, agf: 0 }); } }
  rank(x) { const l = [...this.t.entries()].filter(([, v]) => v.g > 0).sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd).map(([k]) => k), i = l.indexOf(x); return i < 0 ? null : i / Math.max(l.length - 1, 1); }
  features(h, a, refName, base) {
    const H = this.team(h), A = this.team(a), per = (v, g) => g ? v / g : 0, f = {};
    f.eloFark = base.elo ?? 0; f.piFark = base.pi ?? 0; f.golModeliFark = base.dc ?? 0; f.xgModeliFark = base.dx ?? 0;
    f.sezonPuanFark = per(H.pts, H.g) - per(A.pts, A.g); f.sezonAverajFark = per(H.gd, H.g) - per(A.gd, A.g);
    const rh = this.rank(h), ra = this.rank(a); f.sezonSiraFark = rh === null || ra === null ? 0 : ra - rh;
    const lastAvg = (l, k, i) => { const s = l.slice(-k); return s.length ? s.reduce((c, v) => c + v[i], 0) / s.length : 0; };
    f.form5Fark = lastAvg(H.last, 5, 0) - lastAvg(A.last, 5, 0); f.form10AverajFark = lastAvg(H.last, 10, 1) - lastAvg(A.last, 10, 1);
    f.sahaPuanFark = per(H.hp, H.hg) - per(A.ap, A.ag); f.sahaGolFark = per(H.hgf, H.hg) - per(A.agf, A.ag);
    f.isabetliSutFark = H.sot - A.sot; f.yenenIsabetliSutFark = A.sotA - H.sotA; f.toplamSutFark = H.shots - A.shots; f.kornerFark = H.corners - A.corners; f.faulFark = H.fouls - A.fouls; f.kartFark = H.cards - A.cards;
    f.dinlenmeFark = base.rest ?? 0;
    const h2 = this.h2h.get(`${h}|${a}`); f.karsilikliPuan = h2?.length ? h2.reduce((c, v) => c + v, 0) / h2.length : 0;
    const L = this.league.slice(-300), lc = L.length || 1;
    f.ligEvKazanma = L.length ? L.filter(m => m.gh > m.ga).length / lc - 0.44 : 0; f.ligBeraberlik = L.length ? L.filter(m => m.gh === m.ga).length / lc - 0.26 : 0; f.ligGol = L.length ? L.reduce((c, m) => c + m.gh + m.ga, 0) / lc - 2.7 : 0;
    const R = refName && this.ref.get(refName), k = 20;
    f.hakemEvKazanma = R ? (R.hw - 0.44 * R.g) / (R.g + k) : 0; f.hakemGol = R ? (R.goals - 2.7 * R.g) / (R.g + k) : 0; f.hakemKart = R && R.cg ? (R.cards - 3.8 * R.cg) / (R.cg + k) : 0;
    return FEATURES.map(x => f[x]);
  }
  update(r, h, a, gh, ga) {
    const H = this.team(h), A = this.team(a), ph = gh > ga ? 3 : gh === ga ? 1 : 0, pa = ga > gh ? 3 : gh === ga ? 1 : 0, ema = (o, k, v, w = 0.15) => { if (v !== null) o[k] = o[k] * (1 - w) + v * w; };
    H.g++; A.g++; H.pts += ph; A.pts += pa; H.gd += gh - ga; A.gd += ga - gh; H.hg++; H.hp += ph; H.hgf += gh; A.ag++; A.ap += pa; A.agf += ga;
    H.last.push([ph, gh - ga]); A.last.push([pa, ga - gh]); H.last = H.last.slice(-10); A.last = A.last.slice(-10);
    const hst = n(r.HST), ast = n(r.AST); ema(H, "sot", hst); ema(A, "sot", ast); ema(H, "sotA", ast); ema(A, "sotA", hst); ema(H, "shots", n(r.HS)); ema(A, "shots", n(r.AS)); ema(H, "corners", n(r.HC)); ema(A, "corners", n(r.AC)); ema(H, "fouls", n(r.HF)); ema(A, "fouls", n(r.AF));
    const hc = n(r.HY) === null ? null : n(r.HY) + 2 * (n(r.HR) || 0), ac = n(r.AY) === null ? null : n(r.AY) + 2 * (n(r.AR) || 0); ema(H, "cards", hc); ema(A, "cards", ac);
    this.league.push({ gh, ga }); if (this.league.length > 300) this.league.shift();
    if (r.Referee) { const R = this.ref.get(r.Referee) || { g: 0, hw: 0, goals: 0, cards: 0, cg: 0 }; R.g++; R.hw += gh > ga ? 1 : 0; R.goals += gh + ga; if (hc !== null && ac !== null) { R.cards += hc + ac; R.cg++; } this.ref.set(r.Referee, R); }
    const push = (k, v) => { const l = this.h2h.get(k) || []; l.push(v); this.h2h.set(k, l.slice(-6)); }; push(`${h}|${a}`, ph - pa); push(`${a}|${h}`, pa - ph);
  }
}
// Cok sinifli lojistik. offset verilirse piyasanin ustune yalniz duzeltme ogrenir.
export function standardize(X) { const d = X[0]?.length || 0, m = Array(d).fill(0), s = Array(d).fill(0); for (const x of X) x.forEach((v, i) => { m[i] += v; }); m.forEach((_, i) => { m[i] /= X.length || 1; }); for (const x of X) x.forEach((v, i) => { s[i] += (v - m[i]) ** 2; }); s.forEach((v, i) => { s[i] = Math.sqrt(v / (X.length || 1)) || 1; }); return { mean: m, sd: s }; }
export function score(x, w, off) { const K = w.length, sc = w.map((wk, k) => wk[0] + x.reduce((a, v, i) => a + v * wk[i + 1], 0) + (off ? off[k] : 0)), mx = Math.max(...sc), e = sc.map(v => Math.exp(v - mx)), t = e.reduce((a, b) => a + b); return e.map(v => v / t); }
export function fitLogit(rows, d, { iters = 200, lr = 0.2, l2 = 0.002, classes = 3 } = {}) {
  const w = Array.from({ length: classes }, () => Array(d + 1).fill(0));
  for (let it = 0; it < iters; it++) {
    const g = Array.from({ length: classes }, () => Array(d + 1).fill(0));
    for (const r of rows) { const p = score(r.x, w, r.off); for (let k = 0; k < classes; k++) { const e = (k === r.y ? 1 : 0) - p[k]; g[k][0] += e; for (let i = 0; i < d; i++) g[k][i + 1] += e * r.x[i]; } }
    for (let k = 0; k < classes; k++) for (let i = 0; i <= d; i++) w[k][i] += lr * (g[k][i] / rows.length - (i ? l2 * w[k][i] : 0));
  }
  return w;
}
