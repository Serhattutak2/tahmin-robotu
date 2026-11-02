// Her calistirmada: kaynaklardan cek, her maci degerlendir, uygunlari docs/data.json'a yaz, sonuclari defterde kapat.
import fs from "node:fs";
import { Elo, eloProbs, decide, devig, num, fdDate, sameTeam, settle, summarize } from "../lib/engine.mjs";
import { walkLeague, oddsOf } from "../lib/ratings.mjs";
import { x12Features, ouFeatures, softmax } from "../lib/stack.mjs";
import { FD_LEAGUES, FD_SEASONS, fdSeason, fdFixtures, ESPN_SOCCER, ESPN_BASKET, espnBoard, sportsDbCount, mapLimit } from "../lib/sources.mjs";
const cfg = JSON.parse(fs.readFileSync("config/strategy.json", "utf8"));
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const ledger = read("docs/ledger.json", []);
const now = Date.now(), HORIZON = 48 * 3600e3;
const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
const sources = {};
const note = (n, ok, info) => { sources[n] = { ok, info }; };
// Ingiltere saatindeki fikstur zamanini UTC'ye cevir.
function londonToIso(date, time) {
  const guess = new Date(`${date}T${time || "12:00"}:00Z`);
  const l = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/London" })), u = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (l - u)).toISOString();
}
// 1) football-data: gecmis + Pinnacle oranli fikstur -> tam motor
const codes = Object.keys(FD_LEAGUES), recent = FD_SEASONS.slice(-4);
const fdFiles = await mapLimit(recent.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const fdResults = [];
let fixtures = [];
try { fixtures = await fdFixtures(); note("football-data oranlar (Pinnacle)", true, `${fixtures.length} maç`); } catch (e) { note("football-data oranlar (Pinnacle)", false, e.message); }
const model = read("config/model.json", null);
const candidates = [];
for (const c of codes) {
  const rows = fdFiles.filter(f => f?.rows && f.c === c).sort((x, y) => x.s.localeCompare(y.s)).flatMap(f => f.rows.map(r => ({ ...r, date: fdDate(r.Date) }))).filter(r => r.date && r.FTHG !== "" && r.FTHG !== undefined && Number.isFinite(+r.FTHG));
  fdResults.push(...rows);
  const up = fixtures.filter(r => r.Div === c).map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => { if (!r.date) return false; const t = Date.parse(londonToIso(r.date, r.Time)); return t > now && t <= now + HORIZON; });
  for (const rec of walkLeague(rows, up).filter(x => !x.done)) {
    const r = rec.r, o = oddsOf(r), kickoff = londonToIso(r.date, r.Time);
    const base = { id: `fd-${c}-${r.date}-${r.HomeTeam}-${r.AwayTeam}`.replace(/\s+/g, "_"), sport: "football", league: FD_LEAGUES[c], fdDiv: c, date: r.date, kickoff, home: r.HomeTeam, away: r.AwayTeam, fair: o.fair, entry: o.entry, sharp: o.sharp, bookmaker: num(r.B365H) ? "bet365" : "piyasa ortalaması", engine: "tam",
      dossier: { formH: rec.formH, formA: rec.formA, restH: Math.round(rec.restH), restA: Math.round(rec.restA), h2h: rec.h2h, games: rec.games, market: o.fair && devig(o.fair), elo: rec.elo, pi: rec.pi, dc: rec.dc?.x12 || null, xg: rec.dx?.x12 || null, goals: rec.dc ? [rec.dc.lh, rec.dc.la] : null } };
    if (model && o.fair) { const X = x12Features(rec, o.fair); if (X) { base.probs = softmax(X, model.x12); base.dossier.engine = base.probs; } }
    if (model && o.ouFair && o.ouEntry) { const X = ouFeatures(rec, o.ouFair); if (X) { base.ou = { probs: softmax(X, model.ou), entry: o.ouEntry, fair: o.ouFair }; base.dossier.over25 = base.ou.probs[0]; } }
    candidates.push(base);
  }
}
{ const ds = fixtures.map(r => fdDate(r.Date)).filter(Boolean).sort(); if (ds.length) sources["football-data oranlar (Pinnacle)"].info += ` (${ds[0]} – ${ds.at(-1)}), ${candidates.length} tanesi önümüzdeki 48 saatte`; }
note("football-data sonuçlar", fdResults.length > 0, `${fdResults.length} maç`);
// 2) ESPN: tum ligler + basketbol, oran ve Elo
// ESPN uzun tarih araligini reddedebilir: gecmisi 30 gunluk parcalarla, canli gunleri ayrica cek.
const leagues = [...ESPN_SOCCER.map(l => ({ s: "soccer", l })), ...ESPN_BASKET.map(l => ({ s: "basketball", l }))];
const ranges = []; for (let d = 330; d > 0; d -= 30) ranges.push(`${ymd(now - d * 86400e3)}-${ymd(now - Math.max(d - 29, 0) * 86400e3)}`);
const live = `${ymd(now)}-${ymd(now + HORIZON)}`;
const espnErrors = new Map();
const boards = await mapLimit(leagues, 5, async j => {
  const events = new Map();
  let liveOk = false;
  for (const r of [...ranges, live]) {
    try { for (const ev of await espnBoard(j.s, j.l, r)) events.set(ev.id, ev); if (r === live) liveOk = true; }
    catch (e) { espnErrors.set(e.message, (espnErrors.get(e.message) || 0) + 1); }
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
    if (ev.state !== "pre" || t <= now || t > now + HORIZON) continue;
    const dup = candidates.find(c => c.sport === ev.sport && Math.abs(Date.parse(c.kickoff) - t) < 3 * 3600e3 && sameTeam(c.home, ev.home) && sameTeam(c.away, ev.away));
    if (dup) continue;
    const o = ev.odds, odds = o ? (basket ? [o.home, o.away] : [o.home, o.draw, o.away]) : null;
    candidates.push({ id: ev.id, sport: ev.sport, league: ev.league, date: ev.kickoff.slice(0, 10), kickoff: ev.kickoff, home: ev.home, away: ev.away, fair: odds, entry: odds, sharp: false, bookmaker: o?.provider || null,
      model: e.games(ev.homeId, ev.awayId) >= 10 ? eloProbs(e.expected(ev.homeId, ev.awayId), !basket) : null });
  }
}
// 3) Kapsam sayimi: TheSportsDB gunluk mac sayisi
const today = new Date(now).toISOString().slice(0, 10);
const known = {};
for (const [k, s] of [["football", "Soccer"], ["basketball", "Basketball"]]) { try { known[k] = await sportsDbCount(today, s); } catch { known[k] = null; } }
note("TheSportsDB (maç sayımı)", known.football !== null, known.football === null ? "erişilemedi" : `bugün ${known.football} futbol, ${known.basketball ?? "?"} basketbol`);
// 4) Karar. Tam motor: bilesenler + piyasa. Tek kaynakta fark yalnizca Elo'dan gelir, daha yuksek esik ister.
const picks = []; let withOdds = 0, modelled = 0;
for (const c of candidates) {
  if (!c.fair) continue;
  withOdds++; if (c.model || c.probs) modelled++;
  const full = c.engine === "tam";
  const params = full && c.sharp ? cfg : { ...cfg, minEdge: cfg.minEdge + 0.03, weight: 0.1 };
  const labels = c.sport === "basketball" ? [c.home, c.away] : ["MS 1", "MS X", "MS 2"];
  const options = [];
  const d = decide({ fair: c.fair, entry: c.entry, model: c.model, probs: c.probs || null, labels }, params);
  if (d && (c.probs || c.model)) options.push({ ...d, market: "1x2" });
  if (c.ou) { const o = decide({ entry: c.ou.entry, fair: c.ou.fair, probs: c.ou.probs, labels: ["2,5 Üst", "2,5 Alt"] }, params); if (o) options.push({ ...o, market: "ou25" }); }
  const b = options.sort((x, y) => y.edge - x.edge)[0];
  if (!b) continue;
  picks.push({ id: c.id, sport: c.sport, league: c.league, kickoff: c.kickoff, home: c.home, away: c.away, market: b.market, index: b.index, selection: b.label, odds: b.odds, probability: +b.probability.toFixed(4), edge: +b.edge.toFixed(4), minPlayableOdds: +b.minPlayableOdds.toFixed(2), bookmaker: c.bookmaker, sharp: c.sharp, verified: full && c.sharp, fdDiv: c.fdDiv || null, date: c.date, dossier: c.dossier || null });
}
picks.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
// 5) Defter: ilk gorulen oran kilitlenir, sonucu kaynaklardan kapat
for (const p of picks) if (!ledger.some(l => l.id === p.id)) ledger.push({ ...p, dossier: undefined, status: "pending", recordedAt: new Date(now).toISOString() });
for (const l of ledger.filter(x => x.status === "pending" && Date.parse(x.kickoff) < now)) {
  let hs, as;
  if (l.fdDiv) { const r = fdResults.find(x => x.date === l.date && x.Div === l.fdDiv && x.HomeTeam === l.home && x.AwayTeam === l.away); if (r) { hs = +r.FTHG; as = +r.FTAG; } }
  if (hs === undefined) { const ev = espnAll.find(x => (x.id === l.id || (x.sport === l.sport && Math.abs(Date.parse(x.kickoff) - Date.parse(l.kickoff)) < 3 * 3600e3 && sameTeam(x.home, l.home) && sameTeam(x.away, l.away))) && x.completed && Number.isFinite(x.hs)); if (ev) { hs = ev.hs; as = ev.as; } }
  if (hs !== undefined) Object.assign(l, settle(l, hs, as));
  else if (now - Date.parse(l.kickoff) > 10 * 86400e3) Object.assign(l, { status: "void", profit: 0 });
}
const pct = (s, n) => summarize(ledger.filter(n));
const byEvaluated = { football: candidates.filter(c => c.sport === "football").length, basketball: candidates.filter(c => c.sport === "basketball").length };
fs.writeFileSync("docs/ledger.json", JSON.stringify(ledger, null, 1));
fs.writeFileSync("docs/data.json", JSON.stringify({ generatedAt: new Date(now).toISOString(), strategy: cfg, picks, stats: { evaluated: candidates.length, withOdds, modelled, byEvaluated, knownToday: known }, sources, ledger: { all: pct(0, () => true), verified: pct(0, l => l.verified), recent: ledger.filter(l => l.status === "won" || l.status === "lost").slice(-15).reverse() } }, null, 1));
console.log(JSON.stringify({ evaluated: candidates.length, withOdds, modelled, picks: picks.length, sources }, null, 1));
