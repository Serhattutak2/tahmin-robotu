import { americanToDecimal, parseCsv } from "./engine.mjs";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; tahmin-robotu/1.0)" };
export async function getText(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      err = new Error(`HTTP ${r.status}`);
      if (r.status === 404) break;
    } catch (e) { err = e; }
    await new Promise(s => setTimeout(s, 1500 * (i + 1)));
  }
  throw err;
}
export const FD_LEAGUES = { E0: "Premier League", E1: "Championship", E2: "League One", E3: "League Two", EC: "National League", SC0: "İskoçya Premiership", SC1: "İskoçya Championship", SC2: "İskoçya League One", SC3: "İskoçya League Two", D1: "Bundesliga", D2: "2. Bundesliga", I1: "Serie A", I2: "Serie B", SP1: "La Liga", SP2: "La Liga 2", F1: "Ligue 1", F2: "Ligue 2", N1: "Eredivisie", B1: "Belçika Pro League", P1: "Portekiz Primeira Liga", T1: "Süper Lig", G1: "Yunanistan Süper Lig" };
export const FD_SEASONS = ["2021", "2122", "2223", "2324", "2425", "2526", "2627"];
export async function fdSeason(season, code) {
  return parseCsv(await getText(`https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`, 2));
}
export async function fdFixtures() { return parseCsv(await getText("https://www.football-data.co.uk/fixtures.csv")); }
export const ESPN_SOCCER = ["eng.1","eng.2","eng.3","eng.4","eng.5","esp.1","esp.2","ger.1","ger.2","ger.3","ita.1","ita.2","fra.1","fra.2","ned.1","ned.2","por.1","sco.1","tur.1","bel.1","sui.1","aut.1","den.1","swe.1","nor.1","gre.1","pol.1","cze.1","rou.1","hun.1","srb.1","cro.1","bul.1","isr.1","bra.1","bra.2","arg.1","mex.1","usa.1","jpn.1","kor.1","chn.1","sau.1","egy.1","uae.1","qat.1","ind.1","aus.1","irl.1","wal.1","chi.1","col.1","per.1","uru.1","ecu.1","uefa.champions","uefa.europa","uefa.europa.conf","conmebol.libertadores","conmebol.sudamericana"];
export const ESPN_BASKET = ["nba", "wnba", "mens-college-basketball", "womens-college-basketball"];
function parseOdds(c) {
  for (const e of c?.odds || []) {
    const pick = s => e?.moneyline?.[s]?.close?.odds ?? e?.moneyline?.[s]?.open?.odds ?? (s === "home" ? e?.homeTeamOdds?.moneyLine : s === "away" ? e?.awayTeamOdds?.moneyLine : e?.drawOdds?.moneyLine);
    const home = americanToDecimal(pick("home")), draw = americanToDecimal(pick("draw")), away = americanToDecimal(pick("away"));
    if (Number.isFinite(home) && Number.isFinite(away)) return { provider: e?.provider?.name || "ESPN", home, draw, away };
  }
  return null;
}
export function espnEvents(data, sport, league) {
  const out = [];
  for (const ev of data?.events || []) {
    const c = ev?.competitions?.[0]; if (!c) continue;
    const h = c.competitors?.find(x => x.homeAway === "home"), a = c.competitors?.find(x => x.homeAway === "away");
    if (!h?.team?.displayName || !a?.team?.displayName) continue;
    const st = c.status?.type || ev.status?.type || {};
    out.push({ id: `espn-${ev.id}`, sport, league: data?.leagues?.[0]?.name || league, leagueCode: league, kickoff: ev.date, home: h.team.displayName, away: a.team.displayName, homeId: h.team.id, awayId: a.team.id,
      completed: !!st.completed, state: st.state, cancelled: /CANCEL|POSTPON/.test(st.name || ""), hs: Number(h.score?.value ?? h.score), as: Number(a.score?.value ?? a.score), odds: parseOdds(c) });
  }
  return out;
}
export async function espnBoard(sport, league, dates) {
  const path = sport === "soccer" ? `soccer/${league}` : `basketball/${league}`;
  const data = JSON.parse(await getText(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dates}&limit=1000`, 2));
  return espnEvents(data, sport === "soccer" ? "football" : "basketball", league);
}
export async function sportsDbCount(date, sport) {
  const d = JSON.parse(await getText(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${date}&s=${sport}`, 2));
  return (d.events || []).length;
}
export async function mapLimit(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message }; } } }));
  return out;
}
