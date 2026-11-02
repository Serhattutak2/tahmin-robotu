// Her calistirmada: kaynaklardan cek, her maci degerlendir, uygunlari docs/data.json'a yaz, sonuclari defterde kapat.
import fs from "node:fs";
import { Elo, eloProbs, decide, devig, num, fdDate, sameTeam, settle, summarize } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { matchNews } from "../lib/news.mjs";
import { listSports, fetchOdds, fetchScores, chooseSports, eventToCandidate, TOA_TO_FD, fdTeam, eventToRow } from "../lib/oddsapi.mjs";
import { score } from "../lib/features.mjs";
import { x12Features, ouFeatures, softmax } from "../lib/stack.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, fdFixtures, ESPN_SOCCER, ESPN_BASKET, espnBoard, sportsDbCount, mapLimit } from "../lib/sources.mjs";
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
    for (const k of chooseSports(sports, oddsCache, Object.keys(oddsCache).length >= 10 ? Number(process.env.ODDS_PER_RUN || 2) : 10, now)) {
      const r = await fetchOdds(k, toaKey); remaining = r.remaining; fetched++;
      oddsCache[k] = { fetchedAt: now, title: sports.find(x => x.key === k)?.title || k, events: r.body };
    }
    const pendingKeys = [...new Set([...ledger.filter(l => l.status === "pending" && l.sportKey && Date.parse(l.kickoff) + 4 * 3600e3 < now).map(l => l.sportKey), ...read("docs/shadow.json", []).filter(l => l.status === "pending" && l.sportKey?.startsWith("basketball") && Date.parse(l.kickoff) + 4 * 3600e3 < now).map(l => l.sportKey)])];
    if (hour < 3) for (const k of pendingKeys.slice(0, 2)) { const r = await fetchScores(k, toaKey); remaining = r.remaining; scoreEvents.push(...r.body); }
    for (const k of Object.keys(oddsCache)) if (now - oddsCache[k].fetchedAt > 36 * 3600e3) delete oddsCache[k];
    note("The Odds API", true, `${sports.length} aktif lig, bu çalışmada ${fetched} yenilendi, önbellekte ${Object.keys(oddsCache).length}${Number.isFinite(remaining) ? `, kalan kredi ${remaining}` : ""}`);
  } catch (e) { note("The Odds API", false, e.message); }
  fs.writeFileSync("docs/oddscache.json", JSON.stringify(oddsCache));
} else note("The Odds API", false, "Anahtar eklenmedi");
const usedToa = new Set();
// 1) football-data: gecmis + Pinnacle oranli fikstur -> tam motor
const codes = Object.keys(FD_LEAGUES), recent = FD_SEASONS.slice(-4);
const fdFiles = await mapLimit(recent.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const fdResults = [];
let fixtures = [];
try { fixtures = await fdFixtures(); note("football-data oranlar (Pinnacle)", true, `${fixtures.length} maç`); } catch (e) { note("football-data oranlar (Pinnacle)", false, e.message); }
const model = read("config/model.json", null), calibration = read("config/calibration.json", {}), engine = read("config/engine.json", null);
const zf = f => f.map((v, i) => Math.max(-5, Math.min(5, (v - engine.mean[i]) / engine.sd[i])));
const candidates = []; let unmatched = 0;
for (const c of codes) {
  const rows = fdFiles.filter(f => f?.rows && f.c === c).sort((x, y) => x.s.localeCompare(y.s)).flatMap(f => f.rows.map(r => ({ ...r, date: fdDate(r.Date) }))).filter(r => r.date && r.FTHG !== "" && r.FTHG !== undefined && Number.isFinite(+r.FTHG));
  fdResults.push(...rows);
  const up = fixtures.filter(r => r.Div === c).map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => { if (!r.date) return false; const t = Date.parse(londonToIso(r.date, r.Time)); return t > now && inWindow(t); });
  const teams = [...new Set(rows.slice(-500).flatMap(r => [r.HomeTeam, r.AwayTeam]))], toaKeyName = Object.keys(TOA_TO_FD).find(k => TOA_TO_FD[k] === c);
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
    const base = { id: `fd-${c}-${r.date}-${r.HomeTeam}-${r.AwayTeam}`.replace(/\s+/g, "_"), sport: "football", league: FD_LEAGUES[c], fdDiv: c, date: r.date, kickoff, home: r.HomeTeam, away: r.AwayTeam, fair: o.fair, entry: o.entry, sharp: o.sharp, bookmaker: num(r.B365H) ? "bet365" : "piyasa ortalaması", engine: "tam", bookCount: r.bookCount || null, sportKey: r.toa?.sport_key || null, best: { x12: o.max, ou: [num(r["Max>2.5"]), num(r["Max<2.5"])] },
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
  if (!dup) candidates.push({ ...row, oddsAgeHours: Math.round((now - c.fetchedAt) / 3600e3) });
}
// 3) Kapsam sayimi: TheSportsDB gunluk mac sayisi
const today = new Date(now).toISOString().slice(0, 10);
const known = {};
for (const [k, s] of [["football", "Soccer"], ["basketball", "Basketball"]]) { try { known[k] = await sportsDbCount(today, s); } catch { known[k] = null; } }
note("TheSportsDB (maç sayımı)", known.football !== null, known.football === null ? "erişilemedi" : `bugün ${known.football} futbol, ${known.basketball ?? "?"} basketbol`);
// 4) Karar. Tam motor: bilesenler + piyasa. Tek kaynakta fark yalnizca Elo'dan gelir, daha yuksek esik ister.
const filters = read("config/filters.json", []); let filtered = 0, thin = 0;
const picks = []; let withOdds = 0, modelled = 0;
for (const c of candidates) {
  if (!c.fair) continue;
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
const allMatches = candidates.filter(c => c.fair && c.entry && inWindow(Date.parse(c.kickoff))).map(c => { const p = c.probs || devig(c.fair), l = c.sport === "basketball" ? [c.home, c.away] : ["MS 1", "MS X", "MS 2"]; const opts = p.map((v, i) => ({ selection: l[i], probability: +v.toFixed(3), odds: c.entry[i] })).filter(o => o.odds >= 1.3).sort((a, b) => b.probability - a.probability); return { id: c.id, sport: c.sport, league: c.league, kickoff: c.kickoff, home: c.home, away: c.away, dayKey: ist(Date.parse(c.kickoff)), top: opts[0] || null, isPick: pickIds.has(c.id) }; }).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
// Robotun kendi internet taramasi: en yakin secimler icin haberler.
const research = {}; let newsOk = 0, newsErr = null;
await mapLimit(picks.slice(0, 15), 3, async p => { try { research[p.id] = await matchNews(p.home, p.away); newsOk++; } catch (e) { newsErr = e.message; } });
fs.writeFileSync("docs/research.json", JSON.stringify(research, null, 1));
note("Haber taraması", !newsErr || newsOk > 0, `${newsOk}/${Math.min(picks.length, 15)} seçim${newsErr ? ` · hata: ${newsErr}` : ""}`);
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
fs.writeFileSync("docs/data.json", JSON.stringify({ generatedAt: new Date(now).toISOString(), strategy: cfg, picks, days: { today: todayIst, tomorrow: tomorrowIst }, allMatches, unmatched, stats: { evaluated: candidates.length, withOdds, modelled, filtered, thin, byEvaluated, knownToday: known }, sources, everyMatch, evidence, bank: { start: 1000, stake: 10, value: +bank.toFixed(0), curve: curve.slice(-200) }, ledger: { all: pct(0, () => true), verified: pct(0, l => l.verified), recent: ledger.filter(l => l.status === "won" || l.status === "lost").slice(-15).reverse() } }, null, 1));
console.log(JSON.stringify({ evaluated: candidates.length, withOdds, modelled, picks: picks.length, sources }, null, 1));
