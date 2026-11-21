// Canlı tahmin motoru (site ve robot aynı kodu kullanır).
// Kaynak: Polymarket'te oynanan maçların anlık fiyatları. Gerçek parayla dönen bir piyasanın
// orta fiyatı "adil olasılık" kabul edilir. Seçim: maç başına tek tahmin, olasılığı en yüksek
// (ama oranı en az 1,30 olacak) ana pazar. Bahis sitesinde istenen oran adil oranın en az %3 üstüdür.
export const LIVE_URL = now => `https://gamma-api.polymarket.com/events?tag_slug=sports&live=true&closed=false&limit=100&start_time_min=${new Date(now - 5 * 3600e3).toISOString()}`;

const J = x => { if (Array.isArray(x)) return x; try { return JSON.parse(x); } catch { return []; } };
const DEAD = /^(SUS|POST|FT|VFT|AET|PEN|CANC|ABD|)$/i;
const OK_TYPES = new Set(["moneyline", "spreads", "totals", "both_teams_to_score", "soccer_btts"]);
const fmt = v => (v > 0 ? "+" : "") + String(v).replace(".", ",");

function sportOf(e) {
  const t = (e.tags || []).map(x => (x.slug || x.label || "").toLowerCase()).join(" ") + " " + (e.seriesSlug || "") + " " + (e.markets || []).map(m => m.sportsMarketType || "").join(" ");
  if (/volley/.test(t)) return "volleyball";
  if (/basket|nba|ncaab|wnba|euroleague/.test(t)) return "basketball";
  if (/soccer|football|epl|la-liga|bundesliga|serie-a|ligue-1|ucl|uel/.test(t)) return "football";
  return null;
}

function label(m, i, names, sport) {
  const smt = m.sportsMarketType, git = String(m.groupItemTitle || "").trim(), line = Number(m.line);
  if (smt === "moneyline") {
    if (names[0] === "Yes" && names[1] === "No") {
      if (/^draw/i.test(git)) return i === 0 ? "Beraberlik" : "Beraberlik olmaz (iki taraftan biri kazanır)";
      return i === 0 ? `${git} kazanır` : `${git} kazanamaz (beraberlik ya da rakip)`;
    }
    return `${names[i]} kazanır`;
  }
  if (smt === "totals" && Number.isFinite(line)) { const u = sport === "football" ? "gol" : sport === "basketball" ? "sayı" : "sayı"; return `Toplam ${u} ${String(line).replace(".", ",")} ${/^o/i.test(names[i]) ? "Üst" : "Alt"}`; }
  if (smt === "spreads" && Number.isFinite(line)) return `${names[i]} ${fmt(i === 0 ? line : -line)} handikap`;
  if (smt === "both_teams_to_score" || smt === "soccer_btts") return i === 0 ? "Karşılıklı gol var" : "Karşılıklı gol yok";
  return null;
}

export function livePicks(events, now = Date.now()) {
  const games = new Map();
  for (const e of events || []) {
    if (!e || e.ended || e.closed || e.live === false || DEAD.test(String(e.period ?? ""))) continue;
    const st = Date.parse(e.startTime || ""); if (!Number.isFinite(st) || st > now + 5 * 60e3 || st < now - 5 * 3600e3) continue;
    const sport = sportOf(e); if (!sport) continue;
    const key = String(e.gameId || String(e.title || "").split(" - ")[0]);
    const g = games.get(key) || { key, sport, title: String(e.title || "").split(" - ")[0], score: e.score || "", period: e.period || "", elapsed: e.elapsed || "", start: new Date(st).toISOString(), league: (e.tags || []).map(t => t.label).find(l => l && !/^(sports|games|soccer|basketball|volleyball|live)$/i.test(l)) || "", cands: [] };
    if (!g.score && e.score) g.score = e.score;
    for (const m of e.markets || []) {
      if (m.closed || m.acceptingOrders === false || !OK_TYPES.has(m.sportsMarketType)) continue;
      const bid = Number(m.bestBid), ask = Number(m.bestAsk); if (!(bid > 0 && ask > 0 && ask < 1 && ask - bid <= 0.04)) continue;
      const upd = Date.parse(m.updatedAt || ""); if (Number.isFinite(upd) && now - upd > 20 * 60e3) continue;
      const names = J(m.outcomes); if (names.length !== 2) continue;
      const mid = (bid + ask) / 2;
      for (const [i, p] of [[0, mid], [1, 1 - mid]]) {
        if (p < 0.55 || 0.93 / p < 1.3) continue; // güçlü taraf; bahis sitesinde oran (kesintiyle) en az 1,30
        const l = label(m, i, names, sport); if (!l) continue;
        g.cands.push({ p, pmId: String(m.id), pmIdx: i, smt: m.sportsMarketType, label: l });
      }
    }
    games.set(key, g);
  }
  const pref = { moneyline: 0, spreads: 1, totals: 2, both_teams_to_score: 3, soccer_btts: 3 };
  const out = [];
  for (const g of games.values()) {
    if (!g.cands.length) continue;
    g.cands.sort((a, b) => b.p - a.p || pref[a.smt] - pref[b.smt]);
    const c = g.cands[0], [home, away] = g.title.split(/\s+vs\.?\s+/i);
    out.push({ id: `pm-live-${g.key}`, sport: g.sport, league: g.league, home: (home || g.title).trim(), away: (away || "").trim(), start: g.start, score: g.score, period: g.period, elapsed: g.elapsed, label: c.label, p: +c.p.toFixed(3), fair: +(1 / c.p).toFixed(2), est: +(0.93 / c.p).toFixed(2), minPlay: +Math.max(1.3, 1.03 / c.p).toFixed(2), pmId: c.pmId, pmIdx: c.pmIdx, smt: c.smt });
  }
  return out.sort((a, b) => b.p - a.p);
}
