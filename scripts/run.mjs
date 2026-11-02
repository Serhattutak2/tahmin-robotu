// Her calistirmada: kaynaklardan cek, her maci degerlendir, uygunlari docs/data.json'a yaz, sonuclari defterde kapat.
import fs from "node:fs";
import { Elo, eloProbs, decide, num, fdDate, sameTeam, settle, summarize } from "../lib/engine.mjs";
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
// 1) football-data: gecmis (Elo, sonuc) + Pinnacle oranli fikstur
const codes = Object.keys(FD_LEAGUES), recent = FD_SEASONS.slice(-3);
const fdFiles = await mapLimit(recent.flatMap(s => codes.map(c => ({ s, c }))), 6, async j => ({ ...j, rows: await fdSeason(j.s, j.c) }));
const fdElo = {}, fdResults = [];
for (const f of fdFiles.filter(x => x?.rows).sort((a, b) => a.s.localeCompare(b.s))) {
  const rows = f.rows.map(r => ({ ...r, date: fdDate(r.Date) })).filter(r => r.date && r.FTHG !== "" && r.FTHG !== undefined).sort((a, b) => a.date.localeCompare(b.date));
  const e = (fdElo[f.c] ||= new Elo());
  for (const r of rows) { e.update(r.HomeTeam, r.AwayTeam, +r.FTHG, +r.FTAG); fdResults.push(r); }
}
note("football-data sonuçlar", fdResults.length > 0, `${fdResults.length} maç`);
let fixtures = [];
try { fixtures = await fdFixtures(); note("football-data oranlar (Pinnacle)", true, `${fixtures.length} maç`); } catch (e) { note("football-data oranlar (Pinnacle)", false, e.message); }
const candidates = [];
for (const r of fixtures) {
  if (!FD_LEAGUES[r.Div]) continue;
  const date = fdDate(r.Date); if (!date) continue;
  const kickoff = londonToIso(date, r.Time), t = Date.parse(kickoff);
  if (t <= now || t > now + HORIZON) continue;
  const psh = [num(r.PSH), num(r.PSD), num(r.PSA)], avg = [num(r.AvgH), num(r.AvgD), num(r.AvgA)], b365 = [num(r.B365H), num(r.B365D), num(r.B365A)];
  const fair = psh.every(Number.isFinite) ? psh : avg, entry = b365.every(Number.isFinite) ? b365 : avg;
  const e = fdElo[r.Div];
  candidates.push({ id: `fd-${r.Div}-${date}-${r.HomeTeam}-${r.AwayTeam}`.replace(/\s+/g, "_"), sport: "football", league: FD_LEAGUES[r.Div], fdDiv: r.Div, date, kickoff, home: r.HomeTeam, away: r.AwayTeam,
    fair, entry, sharp: psh.every(Number.isFinite), bookmaker: b365.every(Number.isFinite) ? "bet365" : "piyasa ortalaması",
    model: e && e.games(r.HomeTeam, r.AwayTeam) >= 10 ? eloProbs(e.expected(r.HomeTeam, r.AwayTeam)) : null });
}
// 2) ESPN: tum ligler + basketbol, oran ve Elo
const start = ymd(now - 330 * 86400e3), end = ymd(now + HORIZON);
const leagues = [...ESPN_SOCCER.map(l => ({ s: "soccer", l })), ...ESPN_BASKET.map(l => ({ s: "basketball", l }))];
const boards = await mapLimit(leagues, 5, async j => ({ ...j, events: await espnBoard(j.s, j.l, `${start}-${end}`) }));
const okBoards = boards.filter(b => b?.events);
note("ESPN", okBoards.length > 0, `${okBoards.length}/${leagues.length} lig`);
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
// 4) Karar. Tek kaynakli oranda fark yalnizca Elo'dan gelir, daha yuksek esik ister.
const picks = []; let withOdds = 0, modelled = 0;
for (const c of candidates) {
  if (!c.fair) continue;
  withOdds++; if (c.model) modelled++;
  const labels = c.sport === "basketball" ? [c.home, c.away] : ["MS 1", "MS X", "MS 2"];
  const params = c.sharp ? cfg : { ...cfg, minEdge: cfg.minEdge + 0.03 };
  const d = decide({ fair: c.fair, entry: c.entry, model: c.model, labels }, params);
  if (!d) continue;
  picks.push({ id: c.id, sport: c.sport, league: c.league, kickoff: c.kickoff, home: c.home, away: c.away, index: d.index, selection: d.label, odds: d.odds, probability: +(d.probability).toFixed(4), edge: +d.edge.toFixed(4), minPlayableOdds: +d.minPlayableOdds.toFixed(2), bookmaker: c.bookmaker, sharp: c.sharp, verified: c.sharp && c.sport === "football", fdDiv: c.fdDiv || null, date: c.date });
}
picks.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
// 5) Defter: ilk gorulen oran kilitlenir, sonucu kaynaklardan kapat
for (const p of picks) if (!ledger.some(l => l.id === p.id)) ledger.push({ ...p, status: "pending", recordedAt: new Date(now).toISOString() });
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
