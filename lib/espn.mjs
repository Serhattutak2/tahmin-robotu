// ESPN acik skor tablosu: mac listesi + DraftKings oranlari (mac sonucu, alt/ust, handikap). Anahtar gerektirmez.
// Bahis sitesi orani olarak kullanilir (bet365 olmayan liglerde: Sampiyonlar Ligi, Avrupa/Konferans Ligi, Super Lig, Guney Amerika...).
export const ESPN_SOCCER = ["uefa.champions", "uefa.europa", "uefa.europa.conf", "eng.1", "eng.2", "esp.1", "esp.2", "ger.1", "ger.2", "ita.1", "ita.2", "fra.1", "fra.2", "ned.1", "por.1", "bel.1", "sco.1", "tur.1", "gre.1", "aut.1", "sui.1", "den.1", "nor.1", "swe.1", "usa.1", "mex.1", "arg.1", "bra.1", "ind.1", "ksa.1", "jpn.1", "aus.1", "col.1", "chi.1"];
const amer = v => { const x = Number(String(v ?? "").replace("+", "")); if (!Number.isFinite(x) || x === 0) return null; return +(x > 0 ? 1 + x / 100 : 1 + 100 / -x).toFixed(3); };
const cur = o => o?.close?.odds ?? o?.current?.odds ?? o?.open?.odds ?? o?.odds ?? o?.moneyLine;
export async function fetchEspnSoccer(fromDate, toDate, getText) {
  const out = [], errs = [];
  const span = `${fromDate.replace(/-/g, "")}-${toDate.replace(/-/g, "")}`;
  for (const lg of ESPN_SOCCER) {
    try {
      const H0 = { headers: { "User-Agent": "tahmin-robotu (github actions)", Accept: "application/json" } };
      let r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=${span}`, H0), j;
      if (r.ok) j = await r.json(); else { // aralik kabul edilmezse gun gun
        j = { events: [] }; for (let d = new Date(fromDate + "T00:00:00Z"); d <= new Date(toDate + "T00:00:00Z"); d = new Date(d.getTime() + 864e5)) { const r2 = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=${d.toISOString().slice(0, 10).replace(/-/g, "")}`, H0); if (!r2.ok) throw new Error(`HTTP ${r.status}/${r2.status}`); j.events.push(...((await r2.json()).events || [])); } }
      for (const e of j.events || []) {
        const c = e.competitions?.[0]; if (!c) continue; const H = c.competitors?.find(x => x.homeAway === "home"), A = c.competitors?.find(x => x.homeAway === "away"); if (!H || !A) continue;
        const o = (c.odds || [])[0]; if (!o) continue;
        const ml = o.moneyline ? [amer(cur(o.moneyline.home)), amer(cur(o.moneyline.draw) ?? o.drawOdds?.moneyLine), amer(cur(o.moneyline.away))] : null;
        const tl = Number(String(o.total?.over?.close?.line ?? o.total?.over?.open?.line ?? "").replace(/[ou]/i, "")) || Number(o.overUnder) || null;
        const tot = o.total && tl ? { line: tl, over: amer(cur(o.total.over)), under: amer(cur(o.total.under)) } : null;
        out.push({ league: lg, kickoff: new Date(e.date).toISOString(), home: H.team.displayName, away: A.team.displayName, homeShort: H.team.shortDisplayName, awayShort: A.team.shortDisplayName, provider: o.provider?.name || "DraftKings", ml: ml && ml.every(Boolean) ? ml : null, total: tot && tot.over && tot.under ? tot : null, state: e.status?.type?.state || "" });
      }
    } catch (err) { errs.push(`${lg}: ${String(err.message || err).slice(0, 60)}`); }
  }
  return { events: out, errs };
}
// Takim adi eslestirme: Turkce karakterler, kulup ekleri, sponsor onekleri temizlenir; iki takim birlikte ve saat yakinligiyla eslesir.
export const normTeam = x => String(x || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i")
  .replace(/\b(fk|fc|sk|cf|cd|club|sc|ac|as|afc|bk|if|aif|jk|kulubu|spor kulubu|calcio|1907|1903|1905|1923|1929|ssc|ss|us|rc|ca|rcd|sv|vfb|vfl|tsg|bsc|ogc|losc|rams|de|del|la|el|al)\b/g, " ")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const toks = x => new Set(normTeam(x).split(" ").filter(w => w.length >= 3));
export function teamSim(a, b) {
  const x = normTeam(a), y = normTeam(b); if (!x || !y) return 0; if (x === y) return 1;
  const cx = x.replace(/ /g, ""), cy = y.replace(/ /g, ""); if (cx.length >= 4 && cy.length >= 4 && (cx.includes(cy) || cy.includes(cx))) return 0.9;
  const A = toks(a), B = toks(b); let inter = 0; for (const t of A) if (B.has(t) || [...B].some(u => u.length >= 4 && t.length >= 4 && (u.startsWith(t.slice(0, 5)) || t.startsWith(u.slice(0, 5))))) inter++;
  return A.size && B.size ? inter / Math.min(A.size, B.size) * 0.85 : 0;
}
export function matchEvent(c, events, maxH = 3) {
  const t = Date.parse(c.kickoff); let best = null, bs = 0;
  for (const e of events) { const dt = Math.abs(Date.parse(e.kickoff) - t) / 3600e3; if (dt > maxH) continue;
    const sh = Math.max(teamSim(c.home, e.home), teamSim(c.home, e.homeShort)), sa = Math.max(teamSim(c.away, e.away), teamSim(c.away, e.awayShort));
    const s = (sh + sa) / 2 + (dt < 0.3 ? 0.1 : 0); if ((sh >= 0.6 && sa >= 0.6) || (dt < 0.3 && Math.max(sh, sa) >= 0.85)) if (s > bs) { bs = s; best = e; } }
  return best;
}
// NBA: DraftKings toplam sayi cizgisi ve oranlari (gercek ana cizgi).
export async function fetchEspnNba(fromDate, toDate) {
  const H0 = { headers: { "User-Agent": "tahmin-robotu (github actions)", Accept: "application/json" } }, out = [];
  for (let d = new Date(fromDate + "T00:00:00Z"); d <= new Date(toDate + "T00:00:00Z"); d = new Date(d.getTime() + 864e5)) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.toISOString().slice(0, 10).replace(/-/g, "")}`, H0); if (!r.ok) continue;
    for (const e of (await r.json()).events || []) { const c = e.competitions?.[0], o = c?.odds?.[0]; if (!c || !o) continue; const H = c.competitors.find(x => x.homeAway === "home"), A = c.competitors.find(x => x.homeAway === "away");
      const line = Number(String(o.total?.over?.close?.line ?? o.total?.over?.open?.line ?? "").replace(/[ou]/i, "")) || Number(o.overUnder) || null;
      out.push({ kickoff: new Date(e.date).toISOString(), home: H?.team?.displayName, away: A?.team?.displayName, homeNick: H?.team?.name, awayNick: A?.team?.name, line, over: amer(cur(o.total?.over)), under: amer(cur(o.total?.under)), provider: o.provider?.name || "DraftKings" }); }
  }
  return out;
}
