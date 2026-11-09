// Her calistirmada: kaynaklardan cek, her maci degerlendir, uygunlari docs/data.json'a yaz, sonuclari defterde kapat.
import fs from "node:fs";
import { Elo, eloProbs, decide, devig, num, fdDate, sameTeam, settle, summarize } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { bbcFeed, feedFor } from "../lib/news.mjs";
import { injuriesOn } from "../lib/apifootball.mjs";
import { fetchGames, basketLines, threeWay, fetchMarket } from "../lib/polymarket.mjs";
import { listSports, fetchOdds, fetchScores, chooseSports, eventToCandidate, TOA_TO_FD, fdTeam, eventToRow, TOA_EXTRA, fetchEvents, creditCost, realTotals, basketOptions } from "../lib/oddsapi.mjs";
import { score } from "../lib/features.mjs";
import { PointsModel, pOver } from "../lib/basket.mjs";
import { MARKETS, byKey, marketProbs, impliedGoals, recommend, outcome, applyCal } from "../lib/markets.mjs";
import { metaX, estOdds } from "../lib/meta.mjs";
import { x12Features, ouFeatures, softmax } from "../lib/stack.mjs";
import { getText } from "../lib/sources.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, fdFixtures, ESPN_SOCCER, ESPN_BASKET, espnBoard, sportsDbCount, mapLimit } from "../lib/sources.mjs";
import { EXTRA_LEAGUES, ALL_LEAGUES, extraRows, clubElo } from "../lib/sources.mjs";
const cfg = JSON.parse(fs.readFileSync("config/strategy.json", "utf8"));
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const ledger = read("docs/ledger.json", []);
const now = Date.now(), HORIZON = 48 * 3600e3;
const ist = t => new Date(t + 3 * 3600e3).toISOString().slice(0, 10), todayIst = ist(now), tomorrowIst = ist(now + 864e5), inWindow = t => [todayIst, tomorrowIst].includes(ist(t));
const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
const sources = {};
const note = (n, ok, info) => { sources[n] = { ok, info }; };
// Ingiltere saatindeki fikstur zamanini UTC'ye cevir.
function londonToIso(date, time) {
  const guess = new Date(`${date}T${time || "12:00"}:00Z`);
  const l = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/London" })), u = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (l - u)).toISOString();
}
// 0) The Odds API: ucretsiz kotayla ligleri sirayla yenile, oranlari 36 saate kadar kullan.
const toaKey = process.env.ODDS_API_KEY, oddsCache = read("docs/oddscache.json", {}), scoreEvents = [];
if (toaKey) {
  try {
    const sports = await listSports(toaKey), hour = new Date(now).getUTCHours();
    let remaining = null, fetched = 0;
    // Mac listesi ucretsiz: yalniz bugun-yarin maci olan liglere kredi harca.
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const evLists = await mapLimit(sports, 1, async x => { await pause(700); const evs = await fetchEvents(x.key, toaKey); return { key: x.key, n: evs.filter(e => { const t = Date.parse(e.commence_time); return t > now && inWindow(t); }).length, soon: evs.filter(e => { const t = Date.parse(e.commence_time) - now; return t > 3600e3 && t < 5 * 3600e3; }).length }; });
    await pause(1500);
    const active = evLists.filter(e => e?.n > 0).map(e => e.key);
    const d = new Date(now), monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)), daysLeft = Math.max(1, (monthEnd - d) / 864e5);
    const probe = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${toaKey}`); const rh = probe.headers.get("x-requests-remaining"); remaining = rh === null ? NaN : Number(rh);
    const allowance = (Number.isFinite(remaining) ? remaining : 300) / daysLeft;
    // Gunluk hak: bazi calismalar 3 kredilik basketbol/one cikan ligleri yeniler, digerleri 1 kredilik ligleri.
    let budget = allowance < 2 ? 0 : d.getUTCHours() % 6 === 0 || allowance >= 24 ? 3 : 1;
    const due = chooseSports(active.map(k => ({ key: k })), oddsCache, active.length, now);
    for (const k of due) { const cost = creditCost(k); if (cost > budget) continue; budget -= cost; await pause(1500); const r = await fetchOdds(k, toaKey); remaining = r.remaining; fetched++; oddsCache[k] = { fetchedAt: now, title: sports.find(x => x.key === k)?.title || k, events: r.body }; }
    // Maca 1-5 saat kala oran (arastirmaya gore en cok deger burada): kredi yetiyorsa, en cok maci yaklasan futbol ligini yalniz mac sonucu pazariyla (1 kredi) yenile; eski Alt/Ust kalir.
    if (allowance >= 12) { const near = evLists.filter(e => e?.soon > 0 && e.key.startsWith("soccer") && now - (oddsCache[e.key]?.fetchedAt || 0) > 90 * 60e3).sort((a, b) => b.soon - a.soon)[0];
      if (near) { await pause(1500); const r = await fetchOdds(near.key, toaKey, "h2h"); remaining = r.remaining; fetched++; const old = oddsCache[near.key]?.events || [];
        for (const e of r.body) { const o = old.find(x => x.id === e.id); if (o) for (const b of e.bookmakers) { const ob = o.bookmakers.find(x => x.key === b.key); for (const m of ob?.markets || []) if (!b.markets.some(x => x.key === m.key)) b.markets.push(m); } }
        oddsCache[near.key] = { fetchedAt: now, title: sports.find(x => x.key === near.key)?.title || near.key, events: r.body, near: true }; } }
    const pendingKeys = [...new Set([...ledger.filter(l => l.status === "pending" && l.sportKey && Date.parse(l.kickoff) + 4 * 3600e3 < now).map(l => l.sportKey), ...read("docs/tips.json", []).filter(l => l.status === "pending" && l.sportKey && !TOA_TO_FD[l.sportKey] && Date.parse(l.kickoff) + 4 * 3600e3 < now).map(l => l.sportKey)])];
    if (hour >= 6 && hour < 9) for (const k of pendingKeys.slice(0, 4)) { const r = await fetchScores(k, toaKey); remaining = r.remaining; scoreEvents.push(...r.body); }
    for (const k of Object.keys(oddsCache)) if (now - oddsCache[k].fetchedAt > 36 * 3600e3) delete oddsCache[k];
    note("The Odds API", true, `${sports.length} aktif lig, bugün-yarın maçı olan ${active.length}, bu çalışmada ${fetched} yenilendi, önbellekte ${Object.keys(oddsCache).length}${Number.isFinite(remaining) ? `, kalan kredi ${remaining}` : ""}`);
  } catch (e) { note("The Odds API", false, e.message); }
  fs.writeFileSync("docs/oddscache.json", JSON.stringify(oddsCache));
} else note("The Odds API", false, "Anahtar eklenmedi");
const usedToa = new Set();
// 1) football-data: gecmis + Pinnacle oranli fikstur -> tam motor
const extraData = Object.fromEntries((await mapLimit(Object.keys(EXTRA_LEAGUES), 4, async c => [c, await extraRows(c)])).filter(Array.isArray));
note("football-data ek ligler", Object.keys(extraData).length > 0, `${Object.keys(extraData).length}/${Object.keys(EXTRA_LEAGUES).length} lig`);
const fourYears = new Date(now - 4 * 365 * 864e5).toISOString().slice(0, 10);
const codes = Object.keys(ALL_LEAGUES), recent = FD_SEASONS.slice(-4);
const fdFiles = await mapLimit(recent.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const fdResults = [];
let fixtures = [];
try { fixtures = await fdFixtures(); note("football-data oranlar (Pinnacle)", true, `${fixtures.length} maç`); } catch (e) { note("football-data oranlar (Pinnacle)", false, e.message); }
const model = read("config/model.json", null), calibration = read("config/calibration.json", {}), engine = read("config/engine.json", null);
const zf = f => f.map((v, i) => Math.max(-5, Math.min(5, (v - engine.mean[i]) / engine.sd[i])));
// Gercek oran: bet365 ile piyasa ortalamasinin dusugu. Turkiye'de bulunan oranlara daha yakin, iyimser degil.
const lowOf = (a, b) => a && b ? a.map((v, i) => Number.isFinite(v) && Number.isFinite(b[i]) ? Math.min(v, b[i]) : (Number.isFinite(v) ? v : b[i])) : a || b || null;
const candidates = []; let unmatched = 0;
for (const c of codes) {
  const srcRows = c in EXTRA_LEAGUES ? (extraData[c] || []).map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => r.date >= fourYears).sort((x, y) => x.date.localeCompare(y.date)) : fdFiles.filter(f => f?.rows && f.c === c).sort((x, y) => x.s.localeCompare(y.s)).flatMap(f => f.rows.map(r => ({ ...r, date: fdDate(r.Date) })));
  const rows = srcRows.filter(r => r.date && r.FTHG !== "" && r.FTHG !== undefined && Number.isFinite(+r.FTHG));
  fdResults.push(...rows);
  const up = fixtures.filter(r => r.Div === c).map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => { if (!r.date) return false; const t = Date.parse(londonToIso(r.date, r.Time)); return t > now && inWindow(t); });
  const teams = [...new Set(rows.slice(-500).flatMap(r => [r.HomeTeam, r.AwayTeam]))], toaKeyName = Object.keys({ ...TOA_TO_FD, ...TOA_EXTRA }).find(k => ({ ...TOA_TO_FD, ...TOA_EXTRA })[k] === c);
  for (const ev of oddsCache[toaKeyName]?.events || []) {
    const t = Date.parse(ev.commence_time); if (t <= now || !inWindow(t)) continue;
    const h = fdTeam(ev.home_team, teams, sameTeam), a = fdTeam(ev.away_team, teams, sameTeam);
    if (!h || !a) { unmatched++; continue; }
    const row = eventToRow(ev, h, a); if (!row) continue;
    usedToa.add(ev.id);
    const i = up.findIndex(u => u.HomeTeam === h && u.AwayTeam === a);
    if (i >= 0) up[i] = { ...up[i], ...row, Time: up[i].Time }; else up.push(row);
  }
  for (const rec of walkLeague(rows, up).filter(x => !x.done)) {
    const r = rec.r, o = oddsOf(r), kickoff = r.toa ? r.toa.commence_time : londonToIso(r.date, r.Time);
    const base = { rawEvent: r.toa || null, realTotals: r.realTotals || null, feats: rec.feats, id: `fd-${c}-${r.date}-${r.HomeTeam}-${r.AwayTeam}`.replace(/\s+/g, "_"), sport: "football", league: ALL_LEAGUES[c], fdDiv: c, date: r.date, kickoff, home: r.HomeTeam, away: r.AwayTeam, fair: o.fair, entry: o.entry, low: lowOf(o.entry, o.avg), ouLow: lowOf(o.ouEntry, o.ouAvg), sharp: o.sharp, bookmaker: num(r.B365H) ? "bet365" : "piyasa ortalaması", engine: "tam", bookCount: r.bookCount || null, sportKey: r.toa?.sport_key || null, best: { x12: o.max, ou: [num(r["Max>2.5"]), num(r["Max<2.5"])] },
      dossier: { formH: rec.formH, formA: rec.formA, restH: Math.round(rec.restH), restA: Math.round(rec.restA), h2h: rec.h2h, games: rec.games, market: o.fair && devig(o.fair), elo: rec.elo, pi: rec.pi, dc: rec.dc?.x12 || null, xg: rec.dx?.x12 || null, goals: rec.dc ? [rec.dc.lh, rec.dc.la] : null } };
    if (model && o.fair) { const X = x12Features(rec, o.fair); if (X) { const raw = softmax(X, model.x12), g = calibration.gamma || 1, q = raw.map(v => v ** g), t = q.reduce((a, v) => a + v); base.probs = q.map(v => v / t); base.dossier.engine = base.probs; } }
    if (model && o.ouFair && o.ouEntry) { const X = ouFeatures(rec, o.ouFair); if (X) { base.ou = { probs: softmax(X, model.ou), entry: o.ouEntry, fair: o.ouFair }; base.dossier.over25 = base.ou.probs[0]; } }
    if (engine && o.fair && rec.feats) { const m = devig(o.fair), x = zf(rec.feats); base.dossier.statsOnly = score(x, engine.pure); if (engine.residual && rec.games >= 10) { base.probs = score(engine.selectedIds.map(i => x[i]), engine.residual, m.map(v => Math.log(Math.max(v, 1e-4)))); base.dossier.engine = base.probs; } }
    candidates.push(base);
  }
}
{ const ds = fixtures.map(r => fdDate(r.Date)).filter(Boolean).sort(); if (ds.length) sources["football-data oranlar (Pinnacle)"].info += ` (${ds[0]} – ${ds.at(-1)}), ${candidates.length} tanesi önümüzdeki 5 günde`; }
note("football-data sonuçlar", fdResults.length > 0, `${fdResults.length} maç`);
// 2) ESPN: tum ligler + basketbol, oran ve Elo
// ESPN uzun tarih araligini reddedebilir: gecmisi 30 gunluk parcalarla, canli gunleri ayrica cek.
const leagues = [...ESPN_SOCCER.map(l => ({ s: "soccer", l })), ...ESPN_BASKET.map(l => ({ s: "basketball", l }))];
const ranges = []; for (let d = 330; d > 0; d -= 30) ranges.push(`${ymd(now - d * 86400e3)}-${ymd(now - Math.max(d - 29, 0) * 86400e3)}`);
const live = `${ymd(now)}-${ymd(now + HORIZON)}`;
const espnErrors = new Map();
let espnBlocked = !!process.env.SKIP_ESPN;
const boards = await mapLimit(leagues, 5, async j => {
  if (espnBlocked) return { error: "blocked" };
  const events = new Map();
  let liveOk = false;
  for (const r of [...ranges, live]) {
    try { for (const ev of await espnBoard(j.s, j.l, r)) events.set(ev.id, ev); if (r === live) liveOk = true; }
    catch (e) { espnErrors.set(e.message, (espnErrors.get(e.message) || 0) + 1); if (/403/.test(e.message)) { espnBlocked = true; return { error: "blocked" }; } }
    if (!liveOk && r !== live && !events.size && espnErrors.size && ranges.indexOf(r) >= 2) break;
  }
  if (!liveOk) { try { for (const ev of await espnBoard(j.s, j.l, ymd(now))) events.set(ev.id, ev); liveOk = true; } catch (e) { espnErrors.set(e.message, (espnErrors.get(e.message) || 0) + 1); } }
  return liveOk ? { ...j, events: [...events.values()] } : { error: "live" };
});
const okBoards = boards.filter(b => b?.events);
const espnOdds = okBoards.reduce((a, b) => a + b.events.filter(e => e.odds).length, 0);
note("ESPN", okBoards.length > 0, `${okBoards.length}/${leagues.length} lig, ${okBoards.reduce((a, b) => a + b.events.length, 0)} maç, ${espnOdds} oranlı${espnErrors.size ? ` · hata: ${[...espnErrors].slice(0, 2).map(([k, v]) => `${k} x${v}`).join(", ")}` : ""}`);
const espnAll = [];
for (const b of okBoards) {
  const basket = b.s === "basketball", e = new Elo(basket ? { k: 14, home: 70 } : {});
  const evs = [...b.events].sort((x, y) => x.kickoff.localeCompare(y.kickoff));
  for (const ev of evs) {
    espnAll.push(ev);
    if (ev.completed && Number.isFinite(ev.hs) && Number.isFinite(ev.as)) { e.update(ev.homeId, ev.awayId, ev.hs, ev.as); continue; }
    const t = Date.parse(ev.kickoff);
    if (ev.state !== "pre" || t <= now || !inWindow(t)) continue;
    const dup = candidates.find(c => c.sport === ev.sport && Math.abs(Date.parse(c.kickoff) - t) < 3 * 3600e3 && sameTeam(c.home, ev.home) && sameTeam(c.away, ev.away));
    if (dup) continue;
    const o = ev.odds, odds = o ? (basket ? [o.home, o.away] : [o.home, o.draw, o.away]) : null;
    candidates.push({ id: ev.id, sport: ev.sport, league: ev.league, date: ev.kickoff.slice(0, 10), kickoff: ev.kickoff, home: ev.home, away: ev.away, fair: odds, entry: odds, sharp: false, bookmaker: o?.provider || null,
      model: e.games(ev.homeId, ev.awayId) >= 10 ? eloProbs(e.expected(ev.homeId, ev.awayId), !basket) : null });
  }
}
// 2b) Motorla eslesmeyen Odds API maclari: piyasa ortalamasi
for (const c of Object.values(oddsCache)) for (const ev of c.events) {
  const t = Date.parse(ev.commence_time); if (t <= now || !inWindow(t) || usedToa.has(ev.id)) continue;
  const row = eventToCandidate(ev, c.title);
  const dup = candidates.find(x => x.sport === row.sport && Math.abs(Date.parse(x.kickoff) - t) < 3 * 3600e3 && sameTeam(x.home, row.home) && sameTeam(x.away, row.away));
  if (!dup) candidates.push({ ...row, rawEvent: ev, realTotals: realTotals(ev), oddsAgeHours: Math.round((now - c.fetchedAt) / 3600e3) });
}
// 2c) Polymarket: kredisiz maç fiyatlari. Keskin kaynak yerine kullanilir, eslesmeyen maclar da eklenir.
let pmGames = [], pmUsed = 0, pmAdded = 0;
try {
  pmGames = await fetchGames(new Date(now).toISOString(), new Date(now + HORIZON + 36 * 3600e3).toISOString());
  for (const g of pmGames) {
    const t = Date.parse(g.kickoff); if (!Number.isFinite(t) || t <= now || !inWindow(t)) continue;
    const c = candidates.find(x => x.sport === g.sport && Math.abs(Date.parse(x.kickoff) - t) < 4 * 3600e3 && ((sameTeam(x.home, g.a) && sameTeam(x.away, g.b)) || (sameTeam(x.home, g.b) && sameTeam(x.away, g.a))));
    if (g.sport === "football") {
      if (c) { const pr = threeWay(g, sameTeam(c.home, g.a)); if (pr) { c.fair = pr.map(v => 1 / v); c.sharp = true; c.pmFair = true; if (c.engine === "piyasa") c.probs = pr; pmUsed++; } }
      else { const pr = threeWay(g); if (pr) { candidates.push({ id: g.id, sport: "football", league: g.league, kickoff: g.kickoff, date: g.kickoff.slice(0, 10), home: g.a, away: g.b, fair: pr.map(v => 1 / v), probs: pr, entry: pr.map(v => +(1 / v).toFixed(2)), sharp: true, engine: "piyasa", bookCount: 99, bookmaker: "Polymarket", pmFair: true }); pmAdded++; } }
    } else {
      const opts = basketLines(g); if (!opts.length && !g.moneyline) continue;
      if (c) { c.pmOpts = opts; c.pmGame = g; pmUsed++; }
      else { const ml = g.moneyline?.prices; candidates.push({ id: g.id, sport: "basketball", league: g.league, kickoff: g.kickoff, date: g.kickoff.slice(0, 10), home: g.a, away: g.b, fair: ml ? ml.map(v => 1 / v) : null, entry: ml ? ml.map(v => +(1 / v).toFixed(2)) : null, engine: "piyasa", bookCount: 99, bookmaker: "Polymarket", pmOpts: opts, pmGame: g }); pmAdded++; }
    }
  }
  note("Polymarket", true, `${pmGames.length} maç, ${pmUsed} tanesi eşleşti, ${pmAdded} tanesi yeni eklendi`);
} catch (e) { note("Polymarket", false, e.message); }
// 3) Kapsam sayimi: TheSportsDB gunluk mac sayisi
const today = new Date(now).toISOString().slice(0, 10);
const known = {};
for (const [k, s] of [["football", "Soccer"], ["basketball", "Basketball"]]) { try { known[k] = await sportsDbCount(today, s); } catch { known[k] = null; } }
note("TheSportsDB (maç sayımı)", known.football !== null, known.football === null ? "erişilemedi" : `bugün ${known.football} futbol, ${known.basketball ?? "?"} basketbol`);
// 4) Karar. Tam motor: bilesenler + piyasa. Tek kaynakta fark yalnizca Elo'dan gelir, daha yuksek esik ister.
const filters = read("config/filters.json", []); let filtered = 0, thin = 0;
const picks = []; let withOdds = 0, modelled = 0;
for (const c of candidates) {
  if (!c.fair || !Array.isArray(c.entry) || !Array.isArray(c.fair)) continue;
  withOdds++;
  if (c.engine === "piyasa" && c.bookCount < 5) { thin++; continue; } if (c.model || c.probs) modelled++;
  const full = c.engine === "tam";
  const params = full ? (c.sharp ? cfg : { ...cfg, minEdge: Math.max(cfg.minEdge, 0.05), maxOdds: 5 }) : c.engine === "piyasa" ? { ...cfg, minEdge: Math.max(cfg.minEdge, c.sharp ? 0.03 : 0.05), maxOdds: 5 } : { ...cfg, minEdge: cfg.minEdge + 0.03, weight: 0.1 };
  const labels = c.sport === "basketball" ? [c.home, c.away] : ["MS 1", "MS X", "MS 2"];
  const options = [];
  const d = decide({ fair: c.fair, entry: c.entry, model: c.model, probs: c.probs || null, labels }, params);
  if (d && (c.probs || c.model)) options.push({ ...d, market: "1x2" });
  if (c.ou) { const o = decide({ entry: c.ou.entry, fair: c.ou.fair, probs: c.ou.probs, labels: ["2,5 Üst", "2,5 Alt"] }, params); if (o) options.push({ ...o, market: "ou25" }); }
  const b = options.sort((x, y) => y.edge - x.edge)[0];
  if (!b) continue;
  const filt = filters.find(f => (f.key === "league" && f.value === c.league) || (f.key === "market" && f.value === (b.market === "ou25" ? "2,5 Alt/Üst" : "1X2")) || (f.key === "band" && f.value === (b.odds < 2 ? "1,30-2,00" : b.odds < 3 ? "2,00-3,00" : b.odds < 4.5 ? "3,00-4,50" : "4,50+")));
  if (filt) { filtered++; continue; }
  const dv = c.dossier, votes = b.market === "1x2" && dv ? [dv.elo, dv.pi, dv.dc, dv.xg].filter(Boolean) : [], support = votes.filter(m => m[b.index] > (dv.market?.[b.index] ?? 1)).length;
  const bm = c.entryBooks?.[b.index] || c.bookmaker;
  picks.push({ sportKey: c.sportKey || null, engine: c.engine || "espn", bookCount: c.bookCount || null, oddsAgeHours: c.oddsAgeHours ?? null, medianOdds: c.medianOdds?.[b.index] ?? null, agreement: votes.length ? { support, total: votes.length } : null, id: c.id, sport: c.sport, league: c.league, kickoff: c.kickoff, home: c.home, away: c.away, market: b.market, index: b.index, selection: b.label, odds: b.odds, probability: +b.probability.toFixed(4), edge: +b.edge.toFixed(4), minPlayableOdds: +b.minPlayableOdds.toFixed(2), bookmaker: bm, sharp: c.sharp, verified: full && c.sharp, fdDiv: c.fdDiv || null, date: c.date, bestOdds: (b.market === "ou25" ? c.best?.ou : c.best?.x12)?.[b.index] || null, dossier: c.dossier || null });
}
picks.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
// Bugun ve yarin: her macin 1,30 ve ustu en olasi secenegi, oynamaya deger olmasa da.
const pickIds = new Set(picks.map(p => p.id));
const allMatches = candidates.filter(c => c.fair && c.entry && inWindow(Date.parse(c.kickoff))).map(c => { const p = c.probs || devig(c.fair), l = c.sport === "basketball" ? [c.home, c.away] : ["MS 1", "MS X", "MS 2"], i = p.indexOf(Math.max(...p)), o = c.medianOdds?.[i] ?? c.entry[i], pk = picks.find(x => x.id === c.id); return { id: c.id, sport: c.sport, league: c.league, kickoff: c.kickoff, home: c.home, away: c.away, dayKey: ist(Date.parse(c.kickoff)), top: o >= 1.3 ? { selection: l[i], probability: +p[i].toFixed(3), odds: +o.toFixed(2) } : null, lowOdds: o < 1.3, pick: pk ? { selection: pk.selection, odds: pk.odds } : null, isPick: !!pk }; }).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
// Robotun kendi internet taramasi: en yakin secimler icin haberler.
const research = {}; let newsOk = 0, newsErr = null;
try { const feed = await bbcFeed(); for (const p of picks.slice(0, 30)) { const r = feedFor(feed, p.home, p.away); if (r) { research[p.id] = r; newsOk++; } } } catch (e) { newsErr = e.message; }
fs.writeFileSync("docs/research.json", JSON.stringify(research, null, 1));
note("Haber (BBC)", !newsErr, newsErr || `${newsOk} seçimde haber`);
// 5) Defter: ilk gorulen oran kilitlenir, sonucu kaynaklardan kapat
for (const p of picks) if (!ledger.some(l => l.id === p.id)) ledger.push({ ...p, dossier: undefined, status: "pending", recordedAt: new Date(now).toISOString() });
for (const l of ledger.filter(x => x.status === "pending" && Date.parse(x.kickoff) < now)) {
  let hs, as;
  if (l.fdDiv) { const r = fdResults.find(x => x.date === l.date && x.Div === l.fdDiv && x.HomeTeam === l.home && x.AwayTeam === l.away); if (r) { hs = +r.FTHG; as = +r.FTAG; } }
  if (hs === undefined) { const ev = espnAll.find(x => (x.id === l.id || (x.sport === l.sport && Math.abs(Date.parse(x.kickoff) - Date.parse(l.kickoff)) < 3 * 3600e3 && sameTeam(x.home, l.home) && sameTeam(x.away, l.away))) && x.completed && Number.isFinite(x.hs)); if (ev) { hs = ev.hs; as = ev.as; } }
  if (hs === undefined && l.sport === "football") { const r = fdResults.find(x => x.date === l.date && sameTeam(x.HomeTeam, l.home) && sameTeam(x.AwayTeam, l.away)); if (r) { hs = +r.FTHG; as = +r.FTAG; } }
  if (hs === undefined) { const ev = scoreEvents.find(x => `toa-${x.id}` === l.id && x.completed && x.scores); if (ev) { hs = Number(ev.scores.find(q => q.name === ev.home_team)?.score); as = Number(ev.scores.find(q => q.name === ev.away_team)?.score); if (!Number.isFinite(hs) || !Number.isFinite(as)) hs = as = undefined; } }
  if (hs !== undefined) Object.assign(l, settle(l, hs, as));
  else if (now - Date.parse(l.kickoff) > 10 * 86400e3) Object.assign(l, { status: "void", profit: 0 });
}
const pct = (s, n) => summarize(ledger.filter(n));
const byEvaluated = { football: candidates.filter(c => c.sport === "football").length, basketball: candidates.filter(c => c.sport === "basketball").length };
// Tek cumlelik tavsiye: matematik once. Kazanan ayara gore oran degerliyse o oran, degilse pazarin en az orani.
const meta = read("config/meta.json", null), decision = read("config/decision.json", null), win = decision?.winner, cal = decision?.cal || null, tips = read("docs/tips.json", []);
const dc3 = (o, a, b) => o?.[a] > 1 && o?.[b] > 1 ? +(1 / (1 / o[a] + 1 / o[b])).toFixed(2) : null;
const toks = n => String(n).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/^(club|football|united|city|real|sport)$/.test(w));
const acro = n => String(n).split(/\s+/).filter(Boolean).map(w => w[0]).join("").toLowerCase();
const sameName = (a, b) => sameTeam(a, b) || toks(a).some(w => toks(b).includes(w)) || acro(a) === String(b).toLowerCase() || acro(b) === String(a).toLowerCase();
let eloClubs = [], eloUsed = 0; try { eloClubs = await clubElo(todayIst); } catch { try { eloClubs = await clubElo(ist(now - 864e5)); } catch (e) { note("ClubElo", false, e.message); } }
const bkCfg = read("config/basket.json", null);
const legMap = new Map();
function marketPick(c, base) {
  const mk = c.fair && devig(c.fair); if (!mk) return null;
  const ou = c.ou?.fair && devig(c.ou.fair), L = c.low || c.entry, LO = c.ouLow || c.ou?.entry;
  const opts = [["MS1", "MS 1", mk[0], L?.[0]], ["MSX", "MS X", mk[1], L?.[1]], ["MS2", "MS 2", mk[2], L?.[2]], ["1X", "Ev sahibi kaybetmez (1X)", mk[0] + mk[1], dc3(L, 0, 1)], ["X2", "Deplasman kaybetmez (X2)", mk[1] + mk[2], dc3(L, 1, 2)], ["12", "Beraberlik olmaz (12)", mk[0] + mk[2], dc3(L, 0, 2)], ...(ou ? [["U25", "2,5 Üst", ou[0], LO?.[0]], ["A25", "2,5 Alt", ou[1], LO?.[1]]] : [])]
    .map(([key, label, p, o]) => ({ key, label, p, odds: Number.isFinite(o) ? +o.toFixed(2) : null, minPlay: +Math.max(1.3, 1 / p / 0.98).toFixed(2) }))
    .filter(x => x.odds && x.odds >= 1.3).sort((a, b) => b.p - a.p);
  if (!opts.length) return null;
  const b = opts[0];
  if (c.fdDiv) legMap.set(c.id, [{ key: b.key, label: b.label, mp: +b.p.toFixed(4), odds: b.odds, minPlay: b.minPlay }]);
  return { ...base, bet: { rule: "piyasa", safe: false, key: b.key, label: b.label, minPlay: b.minPlay, odds: b.odds, estOdds: null, value: b.odds >= b.minPlay, book: c.bookmaker || null }, alts: opts.slice(1, 3).map(x => ({ label: x.label, minPlay: x.minPlay })) };
}
const matches = candidates.filter(c => inWindow(Date.parse(c.kickoff)) && Date.parse(c.kickoff) > now).map(c => {
  const base = { id: c.id, sport: c.sport, league: c.league, kickoff: c.kickoff, home: c.home, away: c.away, dayKey: ist(Date.parse(c.kickoff)), date: c.date, fdDiv: c.fdDiv || null, sportKey: c.sportKey || null };
  if (c.sport === "basketball") {
    const opts = (c.pmOpts || []).filter(x => x.odd >= 1.2);
    // Basketbol motoru: NBA guc hesabi ile fiyat farki. Son testte kanitlanmadi, ayri karnede izlenir.
    let bk = null; const ml = c.pmGame?.moneyline, er = bkCfg?.nbaElo, rule = bkCfg?.rule;
    if (ml && er && rule && /^nba/.test(c.pmGame.slug) && er[ml.names[0]] && er[ml.names[1]]) { const E = 1 / (1 + 10 ** (-(er[ml.names[0]].r - er[ml.names[1]].r) / 400)); [[E, ml.prices[0], 0], [1 - E, ml.prices[1], 1]].forEach(([q, pr, i]) => { const odd = 1 / pr, pp = rule.w * q + (1 - rule.w) * pr, ev = pp * odd - 1; if (pr > .1 && pr < .84 && odd >= 1.2 && ev >= rule.e && (!bk || ev > bk.ev)) bk = { ev, key: `PM_${ml.id}_${i}`, pmId: ml.id, pmIdx: i, kind: "side", label: `${ml.names[i]} kazanır`, minPlay: +odd.toFixed(2), odds: +odd.toFixed(2), unverified: true, rule: "basket" }; }); }
    if (bk) return { ...base, bet: bk, alts: [] };
    if (!opts.length) { if (!c.fair) return null; const p = c.probs || devig(c.fair); if (!p) return null; const i = p[0] >= p[1] ? 0 : 1, mp = +(1.03 / p[i]).toFixed(2); if (p[i] < .55 || mp < 1.2) return null; return { ...base, bet: { key: i ? "AWAY" : "HOME", label: `${i ? c.away : c.home} kazanır`, minPlay: mp, odds: c.medianOdds?.[i] ? +c.medianOdds[i].toFixed(2) : null, unverified: true, rule: "test" }, alts: [] }; }
    const b = opts[0], need = x => +Math.max(1.2, 1.03 / x.p).toFixed(2);
    return { ...base, bet: { key: b.key, pmId: b.pmId, pmIdx: b.pmIdx, kind: b.kind, line: b.line, label: b.label, minPlay: need(b), odds: b.odd, unverified: true, rule: "test" }, alts: opts.slice(1, 4).map(x => ({ label: x.label, minPlay: need(x) })) };
  }
  // Futbol: 3 yillik testte bahiscilerin ortak orani motorun kendi hesabindan daha isabetli cikti (docs/test3.json).
  // Bu yuzden tahmin piyasanin adil olasiligindan; "en az" siniri adil fiyattir.
  if (c.sport === "football") return marketPick(c, base);
  let eloGoals = null;
  if (!c.fdDiv && eloClubs.length && c.fair) { const h = eloClubs.find(x => sameTeam(x.club, c.home)), a = eloClubs.find(x => sameTeam(x.club, c.away)); if (h && a) { const E = 1 / (1 + 10 ** (-(h.elo + 65 - a.elo) / 400)), g = impliedGoals(eloProbs(E)), m = impliedGoals(devig(c.fair)); eloGoals = [(g[0] + m[0]) / 2, (g[1] + m[1]) / 2]; eloUsed++; } }
  const goals = c.dossier?.goals || eloGoals || (c.fair ? impliedGoals(devig(c.fair)) : null);
  if (!goals) return null;
  const list = recommend(marketProbs(goals[0], goals[1]), cal, { minOdds: 1.3, exclude: c.fdDiv ? [] : MARKETS.filter(m => m.half).map(m => m.key) });
  if (!list.length) return null;
  const e = c.entry, realOdd = k => ({ MS1: e?.[0], MSX: e?.[1], MS2: e?.[2], "1X": dc3(e, 0, 1), X2: dc3(e, 1, 2), 12: dc3(e, 0, 2), U25: c.ou?.entry?.[0], A25: c.ou?.entry?.[1], ...(c.realTotals || {}) })[k] || null;
  let chosen = null;
  if (win && c.fair) { const market = devig(c.fair), math = marketProbs(goals[0], goals[1]), P = k => ({ MS1: 0, MSX: 1, MS2: 2 })[k]; const edge = win.edge, w = win.w, pure3 = win.src === "pure" ? c.dossier?.statsOnly : null, mathP = k => pure3 ? pure3[P(k)] : math[k], vals = ["MS1", "MSX", "MS2"].map(k => ({ k, p: w * mathP(k) + (1 - w) * market[P(k)], o: realOdd(k) })).filter(x => x.o >= 1.3 && x.o <= 6 && x.p * x.o - 1 >= edge).sort((a, b) => b.p * b.o - a.p * a.o); if (vals[0]) chosen = { key: vals[0].k, label: byKey[vals[0].k].label, minPlay: +((1 + edge) / vals[0].p).toFixed(2), odds: vals[0].o, value: true, book: c.entryBooks?.[P(vals[0].k)] || c.bookmaker || null }; }
  if (!chosen && meta && c.fair) {
    const mk = devig(c.fair), ig = impliedGoals(mk), mg = marketProbs(ig[0], ig[1]), mth = marketProbs(goals[0], goals[1]), allowed = MARKETS.filter(m => (c.fdDiv && !(c.fdDiv in EXTRA_LEAGUES)) || !m.half);
    const z = c.feats && meta.mean ? c.feats.map((v, i) => Math.max(-4, Math.min(4, (v - meta.mean[i]) / meta.sd[i]))) : null, code = c.fdDiv || "";
    const L = c.low, lowOdd = k => ({ MS1: L?.[0], MSX: L?.[1], MS2: L?.[2], "1X": dc3(L, 0, 1), X2: dc3(L, 1, 2), 12: dc3(L, 0, 2), U25: c.ouLow?.[0], A25: c.ouLow?.[1] })[k] || null;
    const opts = allowed.map(m => { const pm = mg[m.key], p = applyCal(mth[m.key], meta.cal[m.key]), est = estOdds(pm, m.key), real = realOdd(m.key), odd = real ?? est; if (odd < 1.3 || (real && real < 1.3) || p < 0.6) return null; const mp = applyCal(score(metaX(m.key, p, pm, goals, code, z), meta.weights)[1], meta.metaCal); return { key: m.key, label: m.label, mp, est, real, low: lowOdd(m.key), odd, ev: mp * odd - 1 }; }).filter(Boolean).sort((a, b) => b.ev - a.ev);
    if (!opts.length) return null;
    // Kupon ayaklari: yalniz gecmisi bilinen liglerde ve gercek orani olan secenekler.
    const realOpts = c.fdDiv ? opts.filter(x => x.low >= 1.3).sort((x, y) => y.mp - x.mp) : [];
    legMap.set(c.id, realOpts.slice(0, 4).map(x => ({ key: x.key, label: x.label, mp: +x.mp.toFixed(4), odds: +x.low.toFixed(2) })));
    const need = x => +Math.max(1.3, (1 + (meta.evThreshold || 0)) / x.mp).toFixed(2), b = opts[0], minPlay = need(b);
    const hitBest = realOpts[0], hitOk = !!hitBest && hitBest.mp >= 0.72, hitNeed = hitOk ? +Math.max(1.3, 1.03 / hitBest.mp).toFixed(2) : null;
    const second = hitOk ? { conf: +hitBest.mp.toFixed(4), rule: "isabet", safe: true, key: hitBest.key, label: hitBest.label, minPlay: hitNeed, estOdds: null, odds: +hitBest.low.toFixed(2), book: "gerçek oran" } : null;
    chosen = { rule: "kar", second, safe: b.ev >= (meta.evThreshold ?? 0.05), key: b.key, label: b.label, minPlay, estOdds: b.real ? null : b.est, odds: b.real ? +b.real.toFixed(2) : null, value: !!(b.real && b.real >= minPlay), book: b.real && b.real >= minPlay ? c.bookmaker || null : null };
    return { ...base, bet: chosen, alts: opts.filter(x => x.key !== b.key).slice(0, 3).map(x => ({ label: x.label, minPlay: need(x) })) };
  }
  if (!chosen) { const b = list[0], o = realOdd(b.key); chosen = { safe: b.p >= 0.8, key: b.key, label: b.label, minPlay: b.minPlay, odds: o && o >= b.minPlay ? o : null, value: !!(o && o >= b.minPlay), book: o && o >= b.minPlay ? c.bookmaker || null : null }; }
  return { ...base, bet: chosen, alts: list.filter(x => x.key !== chosen.key).slice(0, 2).map(x => ({ label: x.label, minPlay: x.minPlay })) };
}).filter(Boolean).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
if (eloClubs.length) note("ClubElo", true, `${eloClubs.length} kulüp, ${eloUsed} maçta kullanıldı`);
// Kapanis orani: mac baslarken piyasanin son adil olasiligi (Pinnacle kapanis, yoksa ortalama kapanis).
const closeProb = (r, key) => { const g = ks => { const v = ks.map(k => num(r[k])); return v.every(x => Number.isFinite(x) && x > 1) ? v : null; };
  const x = g(["PSCH", "PSCD", "PSCA"]) || g(["AvgCH", "AvgCD", "AvgCA"]), o = g(["PC>2.5", "PC<2.5"]) || g(["AvgC>2.5", "AvgC<2.5"]), p = x && devig(x), q = o && devig(o);
  return ({ MS1: p?.[0], MSX: p?.[1], MS2: p?.[2], "1X": p && p[0] + p[1], X2: p && p[1] + p[2], 12: p && p[0] + p[2], U25: q?.[0], A25: q?.[1] })[key] || null; };
const tipFrom = (m, bet, rule) => ({ id: `${m.id}#${rule}`, rule, pmId: bet.pmId || null, pmIdx: bet.pmIdx ?? null, sport: m.sport, league: m.league, kickoff: m.kickoff, date: m.date, home: m.home, away: m.away, fdDiv: m.fdDiv, sportKey: m.sportKey, key: bet.key, kind: bet.kind || null, side: bet.side || null, line: bet.line ?? null, unverified: !!bet.unverified, label: bet.label, minPlay: bet.minPlay, odds: bet.odds ?? null, estOdds: bet.estOdds ?? null, b365: bet.b365 ?? null, recordedAt: new Date(now).toISOString(), safe: true, status: "pending" });
// Fiyat disiplini: adil fiyat piyasadan; oyna yalniz gercek oran sinirin ustundeyse. Test: docs/zero.json.
const priceRule = c => { if (c.sport !== "football" || !c.fair) return null; const fair = devig(c.fair); if (!fair) return null;
  // Test (docs/zero2.json): en yuksek oranin %98'i, piyasanin adil fiyatinin ustundeyse; MS ve 2,5 Alt/Ust, oran 1,30-3,20.
  const ouFair = c.ou?.fair && devig(c.ou.fair), cut = 0.98, cand = [];
  const b365 = c.bookmaker === "bet365" ? c.entry : null, b365ou = c.bookmaker === "bet365" ? c.ou?.entry : null;
  fair.forEach((p, i) => cand.push({ p, o: c.best?.x12?.[i], b: b365?.[i], key: ["MS1", "MSX", "MS2"][i], label: ["MS 1", "MS X", "MS 2"][i] }));
  if (ouFair) ouFair.forEach((p, i) => cand.push({ p, o: c.best?.ou?.[i], b: b365ou?.[i], key: ["U25", "A25"][i], label: ["2,5 Üst", "2,5 Alt"][i] }));
  let top = null; for (const x of cand) { if (!Number.isFinite(x.o) || x.o < 1.3) continue; const price = x.o * cut; if (price < 1.3 || price > 3.2) continue; const ev = x.p * price - 1; if (ev >= 0 && (!top || ev > top.ev)) top = { ev, p: +x.p.toFixed(4), key: x.key, label: x.label, odds: +x.o.toFixed(2), minPlay: +Math.max(1.3, 1 / x.p / cut).toFixed(2), b365: Number.isFinite(x.b) ? +x.b.toFixed(2) : null, book: "en yüksek oran", rule: "fiyat" }; if (top) { top.b365ok = !!(top.b365 && top.b365 >= top.minPlay); top.strong = !!(top.b365 && top.b365 * top.p - 1 >= 0.04); } }
  return top; };
for (const m of matches) { const c = candidates.find(x => x.id === m.id); const f = c && priceRule(c); if (f) m.price = f; }
// Oran hareketi: ilk kayittaki orana gore piyasa bu tarafa mi geliyor? (oran dustuyse piyasa da ayni tarafi goruyor)
for (const m of matches) if (m.price) { const t = tips.find(x => x.id === `${m.id}#fiyat`); if (t && t.odds && t.key === m.price.key) { const d = m.price.odds / t.odds - 1; m.price.first = t.odds; m.price.move = Math.abs(d) < 0.02 ? "sabit" : d < 0 ? "düştü" : "yükseldi"; } }
const priceMatches = matches.filter(m => m.price);
// Ayni mac farkli kaynaktan iki kez gelirse tam motorlu olan kalir.
for (let i = matches.length - 1; i >= 0; i--) { const m = matches[i], j = matches.findIndex((x, k) => k !== i && x.sport === m.sport && Math.abs(Date.parse(x.kickoff) - Date.parse(m.kickoff)) < 3 * 3600e3 && sameName(x.home, m.home) && sameName(x.away, m.away)); if (j >= 0 && (!m.fdDiv || matches[j].fdDiv)) matches.splice(i, 1); }
for (const m of matches) { const list = []; if (m.bet.rule === "test") list.push([m.bet, "test"]); else if (m.bet.rule === "basket") list.push([m.bet, "basket"]); else { if (m.bet.safe) list.push([m.bet, "kar"]); if (m.bet.second) list.push([m.bet.second, "isabet"]); } if (m.price) list.push([m.price, "fiyat"]); for (const [bet, rule] of list) if (!tips.some(t => t.id === `${m.id}#${rule}`)) tips.push(tipFrom(m, bet, rule)); }

// Deger avi (Kaunitz ve ark. 2017 yontemi): 1xBet orani, ~25 sitenin ortak adil fiyatinin ve Pinnacle'in ustundeyse.
// Melbet ile 1xBet ayni gruptan, oranlari cok yakin. Gecmis 1xBet orani olmadigi icin ileriye donuk kapanis farkiyla olculur.
const x1Probs = (e, mk) => { const want = mk === "h2h" ? [e.home_team, "Draw", e.away_team] : ["Over", "Under"];
  const take = b => { const m = b.markets?.find(q => q.key === mk); if (!m) return null; const o = want.map(nm => m.outcomes.find(q => q.name === nm && (mk === "h2h" || q.point === 2.5))?.price); return o.every(x => x > 1) ? o : null; };
  const x1 = e.bookmakers.find(b => b.key === "onexbet"), xo = x1 && take(x1); if (!xo) return null;
  const others = e.bookmakers.filter(b => b.key !== "onexbet").map(b => ({ k: b.key, o: take(b) })).filter(b => b.o); if (others.length < 6) return null;
  const cons = want.map((_, i) => others.reduce((a, b) => a + devig(b.o)[i], 0) / others.length), pin = others.find(b => b.k === "pinnacle"), pp = pin && devig(pin.o);
  return { xo, cons, pp, p: pp ? cons.map((v, i) => (v + pp[i]) / 2) : cons, n: others.length };
};
const X1KEYS = { h2h: [["MS1", "MS 1"], ["MSX", "MS X"], ["MS2", "MS 2"]], totals: [["U25", "2,5 Üst"], ["A25", "2,5 Alt"]] }, x1List = [], x1Seen = new Map();
for (const v of Object.values(oddsCache)) for (const e of v.events || []) {
  if (!/^soccer/.test(e.sport_key || "")) continue; const t0 = Date.parse(e.commence_time), dk = ist(t0);
  for (const mk of ["h2h", "totals"]) { const r = x1Probs(e, mk); if (!r) continue; x1Seen.set(`toa-${e.id}|${mk}`, r);
    if (t0 <= now || (dk !== todayIst && dk !== tomorrowIst)) continue;
    r.xo.forEach((o, i) => { const ev = o * r.p[i] - 1, evc = o * r.cons[i] - 1, evp = r.pp ? o * r.pp[i] - 1 : 0; if (o < 1.3 || o > 5 || ev < 0.02 || evc < 0 || evp < 0) return;
      const [key, label] = X1KEYS[mk][i], old = x1List.find(x => x.id === `toa-${e.id}`); if (old && old.ev >= ev) return; if (old) x1List.splice(x1List.indexOf(old), 1);
      x1List.push({ id: `toa-${e.id}`, sport: "football", sportKey: e.sport_key, league: v.title || e.sport_title, home: e.home_team, away: e.away_team, kickoff: e.commence_time, date: new Date(t0).toISOString().slice(0, 10), dayKey: dk, key, label, odds: o, p: +r.p[i].toFixed(4), ev: +ev.toFixed(4), minPlay: +Math.max(1.3, 1.02 / r.p[i]).toFixed(2), books: r.n, pinnacle: !!r.pp }); }); }
}
x1List.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
for (const x of x1List) if (!tips.some(t => t.id === `${x.id}#x1`)) tips.push({ ...tipFrom({ ...x, fdDiv: null }, { key: x.key, label: x.label, minPlay: x.minPlay, odds: x.odds }, "x1"), p0: x.p });
// Kapanis farki: mac baslayana kadar her calismada son adil olasilik saklanir.
for (const t of tips.filter(t => t.rule === "x1" && Date.parse(t.kickoff) > now)) { const mk = /^(U25|A25)$/.test(t.key) ? "totals" : "h2h", r = x1Seen.get(`${t.id.split("#")[0]}|${mk}`); if (!r) continue; const i = X1KEYS[mk].findIndex(k => k[0] === t.key); t.lastFair = +r.p[i].toFixed(4); t.lastX1 = r.xo[i]; t.lastAt = new Date(now).toISOString(); }
// Basketbol erken alt/ust (NBA). docs/basket3.json: acilis cizgisinde motor en az 0,60 eminse son 3 sezonun ucunde de artida,
// cizgi kapanisa kadar 2'ye 1 bizim tarafa gitti. Mevcut basketbol bolumune dokunmaz; ayri liste ve ayri karne.
const bkou = [];
{ const nm = "NBA sonuçları (TheSportsDB)";
  try { // Ucretsiz anahtarla sezon listesi ve son biten maclar; her calismada birikir, docs/nbaresults.json'da saklanir.
    const cache = read("docs/nbaresults.json", {}); let calls = 0;
    for (const u of ["https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=4387&s=2026-2027", "https://www.thesportsdb.com/api/v1/json/123/eventspastleague.php?id=4387"]) {
      try { const j = JSON.parse(await getText(u, 1)); calls++; for (const e of j.events || []) { const hs = Number(e.intHomeScore), as = Number(e.intAwayScore); if (e.idEvent && hs + as > 100) cache[e.idEvent] = { day: e.dateEvent, h: e.strHomeTeam, a: e.strAwayTeam, hs, as }; } } catch {} }
    fs.writeFileSync("docs/nbaresults.json", JSON.stringify(cache));
const done = Object.values(cache).filter(g => g && g.hs + g.as > 100).sort((a, b) => a.day.localeCompare(b.day));
    const M = new PointsModel({ mean: done.length ? done.reduce((s, g) => s + g.hs + g.as, 0) / done.length / 2 : 112, home: 2, lr: 0.06 });
    for (const g of done) M.update(g.h, g.a, g.hs, g.as, g.day);
    const teamOf = n => Object.keys(M.t).find(k => sameTeam(k, n)) || Object.keys(M.t).find(k => k.split(" ").at(-1).toLowerCase() === String(n).split(" ").at(-1).toLowerCase());
    for (const c of candidates.filter(c => c.pmGame && /^nba/.test(c.pmGame.slug || "") && Date.parse(c.kickoff) > now && inWindow(Date.parse(c.kickoff)))) {
      const g = c.pmGame, H = teamOf(c.home), A = teamOf(c.away); if (!H || !A) continue;
      const tl = (g.lines || []).filter(l => l.type === "totals" && l.prices?.length === 2 && Number.isFinite(+l.line)).sort((x, y) => Math.abs(x.prices[0] - .5) - Math.abs(y.prices[0] - .5))[0]; if (!tl) continue;
      const p = M.predict(H, A, c.kickoff.slice(0, 10)); if (p.games < 8) continue;
      const po = pOver(p, +tl.line), oi = Math.max(0, tl.names.findIndex(n => /over/i.test(n))), up = po >= 0.5, i = up ? oi : 1 - oi, q = Math.max(po, 1 - po); if (q < 0.6) continue;
      bkou.push({ id: c.id, sport: "basketball", league: "NBA", home: c.home, away: c.away, kickoff: c.kickoff, date: c.date, dayKey: ist(Date.parse(c.kickoff)), key: `PM_${tl.id}_${i}`, pmId: tl.id, pmIdx: i, label: `Toplam sayı ${String(tl.line).replace(".", ",")} ${up ? "Üst" : "Alt"}`, line: +tl.line, exp: +p.total.toFixed(1), pmOdds: +(1 / tl.prices[i]).toFixed(2), minPlay: 1.85 });
    }
    // Karnede kar, testteki gibi standart bahis orani (1,85) ile sayilir.
    for (const x of bkou) if (!tips.some(t => t.id === `${x.id}#bkou`)) tips.push(tipFrom({ ...x, fdDiv: null }, { key: x.key, pmId: x.pmId, pmIdx: x.pmIdx, label: x.label, minPlay: 1.85, odds: 1.85 }, "bkou"));
    note(nm, true, `${done.length} biten maç (${calls} sorgu), ${bkou.length} erken alt/üst seçimi`);
  } catch (e) { note(nm, false, e.message); } }
for (const t of tips.filter(x => x.pmId && x.status === "pending" && Date.parse(x.kickoff) + 3 * 3600e3 < now).slice(0, 40)) { try { const m = await fetchMarket(t.pmId), pr = JSON.parse(m.outcomePrices || "[]").map(Number); if (m.closed && (pr[t.pmIdx] === 1 || pr[t.pmIdx] === 0)) { const w = pr[t.pmIdx] === 1, paid = t.odds || t.minPlay; Object.assign(t, { status: w ? "won" : "lost", won: w, score: "", profit: +(w ? paid - 1 : -1).toFixed(2) }); } } catch {} }
for (const t of tips.filter(x => !x.pmId && x.status === "pending" && Date.parse(x.kickoff) < now)) {
  let hs, as, hh = null, ha = null;
  const fd = t.sport === "football" && fdResults.find(r => r.date === t.date && sameTeam(r.HomeTeam, t.home) && sameTeam(r.AwayTeam, t.away));
  if (fd) { hs = +fd.FTHG; as = +fd.FTAG; if (fd.HTHG !== "" && fd.HTHG !== undefined) { hh = +fd.HTHG; ha = +fd.HTAG; } const pc = closeProb(fd, t.key); if (pc) { if (t.odds) t.clv = +(t.odds * pc - 1).toFixed(3); if (t.b365) t.clvB365 = +(t.b365 * pc - 1).toFixed(3); } }
  const ev = hs === undefined && scoreEvents.find(v => `toa-${v.id}` === t.id.split("#")[0] && v.completed && v.scores);
  if (ev) { hs = Number(ev.scores.find(q => q.name === ev.home_team)?.score); as = Number(ev.scores.find(q => q.name === ev.away_team)?.score); }
  if (Number.isFinite(hs) && Number.isFinite(as)) { const w = t.kind === "total" ? (t.side === "over" ? hs + as > t.line : hs + as < t.line) : t.kind === "spread" ? (t.side === "home" ? hs + t.line > as : as + t.line > hs) : t.key === "HOME" ? hs > as : t.key === "AWAY" ? as > hs : outcome(byKey[t.key], hs, as, hh, ha) === 1; const paid = t.odds || t.estOdds || t.minPlay; Object.assign(t, { status: w ? "won" : "lost", won: w, score: `${hs}-${as}`, profit: +(w ? paid - 1 : -1).toFixed(2) }); if (t.b365) t.profitB365 = +(w ? t.b365 - 1 : -1).toFixed(2); }
  else if (now - Date.parse(t.kickoff) > 14 * 864e5) t.status = "void";
}
// Sakat ve cezali oyuncular (API-Football). Kredi icin 5 saatte bir yenilenir, arada onbellek kullanilir.
{ const afKey = process.env.API_FOOTBALL_KEY, nm = "API-Football (sakat/cezalı)";
  if (!afKey) note(nm, false, "Anahtar eklenmedi");
  else { try { const cache = read("docs/injuries.json", { at: 0, list: [] }); let calls = 0;
      if (now - cache.at > 5 * 3600e3) { const list = []; for (const d of [todayIst, tomorrowIst]) { const r = await injuriesOn(d, afKey, 5); calls += r.calls; list.push(...r.list); } cache.at = now; cache.list = list; fs.writeFileSync("docs/injuries.json", JSON.stringify(cache)); }
      let hit = 0; const fmt = x => `${x.player}${x.reason ? ` (${x.reason})` : ""}`;
      for (const m of matches.filter(x => x.sport === "football")) { const H = cache.list.filter(x => x.team && sameName(x.team, m.home)), A = cache.list.filter(x => x.team && sameName(x.team, m.away)); if (!H.length && !A.length) continue; hit++; m.missing = { home: [...new Set(H.map(fmt))], away: [...new Set(A.map(fmt))] };
        const side = k => /^(MS1|1X)$/.test(k) ? "home" : /^(MS2|X2)$/.test(k) ? "away" : null; for (const b of [m.price, m.bet?.second]) { const sd = b && side(b.key); if (sd && m.missing[sd].length >= 3) b.warn = `Seçilen tarafta ${m.missing[sd].length} eksik oyuncu var`; } }
      note(nm, true, `${cache.list.length} oyuncu, ${hit} maçta eşleşti${calls ? `, ${calls} sorgu` : ", önbellekten"}`);
    } catch (e) { note(nm, false, e.message); } } }
fs.writeFileSync("docs/tips.json", JSON.stringify(tips.slice(-20000)));
// 2'yi gecen kuponlar: farkli maclardan en fazla 3 ayak, gercek oranlarla. Ilk ayak baslayinca kupon kilitlenir.
for (const m of matches) if (m.sport === "football" && legMap.get(m.id)?.length) m.legs = legMap.get(m.id);
// Kuponlar (docs/test3.json, son 3 yil): "en olası" kupon bet365 oranıyla sifira yakin; "deger" kuponu en yuksek oranla artida, bet365 ile ekside.
const couponsOf = (pool0, maxN, need, score) => {
  const pool = pool0.filter(x => Date.parse(x.m.kickoff) > now).sort((a, b) => b.l.mp - a.l.mp).slice(0, 30), out = [], used = new Set();
  for (let n = 0; n < 3; n++) {
    const P = pool.filter(x => !used.has(x.m.id)); let best = null;
    const tryIt = legs => { if (new Set(legs.map(x => x.m.id)).size < legs.length) return; const odds = legs.reduce((a, x) => a * x.l.odds, 1); if (odds < 2) return; const p = legs.reduce((a, x) => a * x.l.mp, 1); if (p < need) return; const sc = score(p, odds); if (!best || sc > best.sc) best = { legs, odds, p, sc }; };
    for (let i = 0; i < P.length; i++) { tryIt([P[i]]); for (let j = i + 1; j < P.length; j++) { tryIt([P[i], P[j]]); if (maxN > 2) for (let k = j + 1; k < P.length; k++) tryIt([P[i], P[j], P[k]]); } }
    if (!best) break;
    best.legs.forEach(x => used.add(x.m.id));
    out.push({ odds: +best.odds.toFixed(2), conf: +best.p.toFixed(4), legs: best.legs.map(({ m, l }) => ({ matchId: m.id, home: m.home, away: m.away, league: m.league, kickoff: m.kickoff, date: m.date, fdDiv: m.fdDiv, key: l.key, label: l.label, odds: l.odds, minPlay: l.minPlay ?? null })) });
  }
  return out;
};
const coupons = read("docs/coupons.json", []);
const fb = d => matches.filter(m => m.sport === "football" && m.dayKey === d);
const KINDS = { olasi: { maxN: 3, need: 0.4, score: p => p, pool: d => fb(d).filter(m => m.fdDiv && m.legs?.length).map(m => ({ m, l: m.legs[0] })) },
  deger: { maxN: 2, need: 0.25, score: (p, o) => p * o, pool: d => fb(d).filter(m => m.price?.p).map(m => ({ m, l: { key: m.price.key, label: m.price.label, mp: m.price.p, odds: m.price.odds, minPlay: m.price.minPlay } })) } };
for (const d of [todayIst, tomorrowIst]) for (const [type, K] of Object.entries(KINDS)) {
  const old = coupons.filter(x => x.dayKey === d && x.type === type), locked = old.some(x => x.legs.some(l => Date.parse(l.kickoff) <= now));
  if (locked) continue;
  for (const x of old) coupons.splice(coupons.indexOf(x), 1);
  couponsOf(K.pool(d), K.maxN, K.need, K.score).forEach((x, i) => coupons.push({ id: `${d}#${type}${i + 1}`, type, dayKey: d, createdAt: new Date(now).toISOString(), status: "pending", ...x }));
}
for (const cp of coupons.filter(x => x.status === "pending")) {
  for (const l of cp.legs.filter(l => l.status !== "won" && l.status !== "lost" && Date.parse(l.kickoff) < now)) {
    const r = fdResults.find(x => x.date === l.date && (x.Div === l.fdDiv || !l.fdDiv) && sameTeam(x.HomeTeam, l.home) && sameTeam(x.AwayTeam, l.away));
    if (!r) continue; const hh = r.HTHG !== "" && r.HTHG !== undefined ? +r.HTHG : null, ha = hh === null ? null : +r.HTAG, w = outcome(byKey[l.key], +r.FTHG, +r.FTAG, hh, ha);
    if (w === null) continue; l.status = w ? "won" : "lost"; l.score = `${r.FTHG}-${r.FTAG}`;
  }
  if (cp.legs.some(l => l.status === "lost")) Object.assign(cp, { status: "lost", profit: -1 });
  else if (cp.legs.every(l => l.status === "won")) Object.assign(cp, { status: "won", profit: +(cp.odds - 1).toFixed(2) });
  else if (now - Date.parse(cp.legs.at(-1).kickoff) > 14 * 864e5) cp.status = "void";
}
fs.writeFileSync("docs/coupons.json", JSON.stringify(coupons.slice(-2000)));
// Son 3 gun + bugun baslamis maclar: verilen tahminler silinmez, sonucuyla gosterilir.
const pastDays = [3, 2, 1].map(n => ist(now - n * 864e5)), pastSet = new Set([...pastDays, todayIst]);
const past = { days: pastDays, tips: tips.filter(t => t.sport === "football" && (t.rule === "isabet" || t.rule === "fiyat" || t.rule === "x1") && pastSet.has(ist(Date.parse(t.kickoff))) && Date.parse(t.kickoff) <= now).map(t => ({ dayKey: ist(Date.parse(t.kickoff)), rule: t.rule, league: t.league, kickoff: t.kickoff, home: t.home, away: t.away, label: t.label, odds: t.odds, minPlay: t.minPlay, status: t.status, score: t.score || "" })).sort((a, b) => a.kickoff.localeCompare(b.kickoff)), coupons: coupons.filter(x => pastSet.has(x.dayKey)) };
const cpCard = t => { const l = coupons.filter(x => x.type === t), dn = l.filter(x => x.status === "won" || x.status === "lost"); return { done: dn.length, won: dn.filter(x => x.status === "won").length, pending: l.filter(x => x.status === "pending").length, profit: +dn.reduce((a, x) => a + x.profit, 0).toFixed(1) }; }, couponCard = { olasi: cpCard("olasi"), deger: cpCard("deger") };
const doneTips = tips.filter(t => (t.status === "won" || t.status === "lost") && t.safe), cardOf = r => { const d = doneTips.filter(t => t.rule === r); return { done: d.length, won: d.filter(t => t.won).length, pending: tips.filter(t => t.status === "pending" && t.rule === r).length, profit: +d.reduce((a, t) => a + t.profit, 0).toFixed(1) }; }, clvOf = r => { const l = tips.filter(t => t.rule === r && Number.isFinite(t.clv)), lb = l.filter(t => Number.isFinite(t.clvB365)), lp = tips.filter(t => t.rule === r && Number.isFinite(t.profitB365)); return { n: l.length, best100: l.length ? +(l.reduce((a, t) => a + t.clv, 0) / l.length * 100).toFixed(1) : null, b365_100: lb.length ? +(lb.reduce((a, t) => a + t.clvB365, 0) / lb.length * 100).toFixed(1) : null, b365Profit: +lp.reduce((a, t) => a + t.profitB365, 0).toFixed(1), b365Done: lp.length }; }, x1Card = (() => { const l = tips.filter(t => t.rule === "x1"), c = l.filter(t => Date.parse(t.kickoff) <= now && t.lastFair), dn = l.filter(t => t.status === "won" || t.status === "lost"); return { n: l.length, clvN: c.length, clv100: c.length ? +(c.reduce((a, t) => a + (t.odds * t.lastFair - 1), 0) / c.length * 100).toFixed(1) : null, done: dn.length, won: dn.filter(t => t.won).length, profit: +dn.reduce((a, t) => a + t.profit, 0).toFixed(1), pending: l.filter(t => t.status === "pending").length }; })(), tipCard = { x1: x1Card, clvFiyat: clvOf("fiyat"), clvIsabet: clvOf("isabet"), kar: cardOf("kar"), isabet: cardOf("isabet"), test: cardOf("test"), basket: cardOf("basket"), fiyat: cardOf("fiyat") };
const verdict = "Geçmiş testlerde motor çok tutturdu ama kâr kanıtlanmadı; beklenti en iyi ihtimalle sıfıra yakın. Oran sınırını geçmeyen maçı oynama, küçük ve sabit birimle kal.";
// Her mac defteri: secilsin secilmesin tum tahminler sonuc gorulmeden kaydedilir, sonra puanlanir.
const shadow = read("docs/shadow.json", []);
for (const c of candidates) { if (!c.fair || shadow.some(x => x.id === c.id)) continue; const market = devig(c.fair); if (!market) continue; shadow.push({ id: c.id, sport: c.sport, league: c.league, sportKey: c.sportKey || null, kickoff: c.kickoff, date: c.date, home: c.home, away: c.away, motor: (c.probs || market).map(v => +v.toFixed(4)), market: market.map(v => +v.toFixed(4)), status: "pending" }); }
for (const x of shadow.filter(v => v.status === "pending" && Date.parse(v.kickoff) < now)) {
  let hs, as;
  const fd = x.sport === "football" && fdResults.find(r => r.date === x.date && sameTeam(r.HomeTeam, x.home) && sameTeam(r.AwayTeam, x.away));
  if (fd) { hs = +fd.FTHG; as = +fd.FTAG; }
  const ev = hs === undefined && scoreEvents.find(v => `toa-${v.id}` === x.id && v.completed && v.scores);
  if (ev) { hs = Number(ev.scores.find(q => q.name === ev.home_team)?.score); as = Number(ev.scores.find(q => q.name === ev.away_team)?.score); }
  if (Number.isFinite(hs) && Number.isFinite(as)) { x.y = x.sport === "basketball" ? (hs > as ? 0 : 1) : hs > as ? 0 : hs === as ? 1 : 2; x.score = `${hs}-${as}`; x.status = "done"; }
  else if (now - Date.parse(x.kickoff) > 14 * 86400e3) x.status = "void";
}
const keep = shadow.slice(-20000);
fs.writeFileSync("docs/shadow.json", JSON.stringify(keep));
const sd = keep.filter(x => x.status === "done"), brier = (p, y) => p.reduce((a, v, i) => a + (v - (i === y ? 1 : 0)) ** 2, 0), acc = (f) => sd.length ? +(sd.reduce((a, x) => a + f(x), 0) / sd.length).toFixed(4) : null;
const everyMatch = { pending: keep.filter(x => x.status === "pending").length, done: sd.length, motor: acc(x => brier(x.motor, x.y)), piyasa: acc(x => brier(x.market, x.y)), isabetMotor: acc(x => x.motor.indexOf(Math.max(...x.motor)) === x.y ? 1 : 0) };
const settled = ledger.filter(l => l.status === "won" || l.status === "lost");
let bank = 1000; const curve = settled.sort((a, b) => a.kickoff.localeCompare(b.kickoff)).map(l => { bank += l.profit * 10; return +bank.toFixed(0); });
const sAll = summarize(settled), mean = sAll.roi ?? 0, se = settled.length ? Math.sqrt(settled.reduce((a, l) => a + (l.profit - mean) ** 2, 0) / settled.length / settled.length) : 0, low = mean - 1.96 * se;
const evidence = settled.length >= 500 && low > 0 ? "kanitli" : settled.length >= 100 && mean > 0 ? "umut" : "deneme";
fs.writeFileSync("docs/ledger.json", JSON.stringify(ledger, null, 1));
fs.writeFileSync("docs/data.json", JSON.stringify({ generatedAt: new Date(now).toISOString(), strategy: cfg, picks, days: { today: todayIst, tomorrow: tomorrowIst }, x1: x1List, bkou, kârTablosu: buildProfit(tipCard, couponCard), matches, tipCard, couponCard, coupons: coupons.filter(x => x.dayKey === todayIst || x.dayKey === tomorrowIst), past, verdict, tipRecent: doneTips.slice(-15).reverse(), allMatches, unmatched, stats: { evaluated: candidates.length, withOdds, modelled, filtered, thin, byEvaluated, knownToday: known }, sources, everyMatch, evidence, bank: { start: 1000, stake: 10, value: +bank.toFixed(0), curve: curve.slice(-200) }, ledger: { all: pct(0, () => true), verified: pct(0, l => l.verified), recent: ledger.filter(l => l.status === "won" || l.status === "lost").slice(-15).reverse() } }, null, 1));
console.log(JSON.stringify({ evaluated: candidates.length, withOdds, modelled, picks: picks.length, sources }, null, 1));

// Gunluk sayfadaki kar tablosu: test sonuclari (son 3 yil, son 6 ay) ve sitede gerceklesen.
function buildProfit(tc, cc) {
  const t3 = read("docs/test3.json", {}), x1 = read("docs/x1test.json", {}).sonuç || {}, six = t3.son6Ay || {};
  const S = x => x && x.seçim ? { n: x.seçim, won: x.tutan, profit: x.kar } : null, L = x => x ? { n: x.done ?? 0, won: x.won ?? 0, profit: x.profit ?? 0 } : null;
  return [
    { ad: "Değer avı", not: "tek bir bahis sitesinin oranıyla", t3: S(x1["önce|bet365"]?.hepsi), t6: S(x1["önce|bet365"]?.son6Ay), canlı: L(tc.x1) },
    { ad: "Motorun seçimleri", not: "en yüksek oranla", t3: S(t3.motorunSeçimleri?.enYüksekOran), t6: S(six.motorunSeçimleri?.enYüksek), canlı: L(tc.fiyat) },
    { ad: "Basketbol erken alt/üst", not: "NBA, standart bahis oranıyla (1,91)", t3: (() => { const b = read("docs/basket3.json", {}).sonuç?.["alt/üst|açılış"]?.son3Sezon; return b?.seçim ? { n: b.seçim, won: b.tutan, profit: b.kar } : null; })(), t6: null, canlı: (() => { const l = tips.filter(t => t.rule === "bkou" && (t.status === "won" || t.status === "lost")); return { n: l.length, won: l.filter(t => t.won).length, profit: +l.reduce((a, t) => a + t.profit, 0).toFixed(1) }; })() },
    { ad: "En olası kupon", not: "bet365 oranıyla", t3: S(t3.kuponEnOlası?.bet365), t6: S(six.kuponEnOlası?.bet365), canlı: L(cc?.olasi) },
    { ad: "Değer kuponu", not: "en yüksek oranla", t3: S(t3.kuponDeğer?.enYüksekOran), t6: S(six.kuponDeğer?.enYüksek), canlı: L(cc?.deger) },
  ];
}
