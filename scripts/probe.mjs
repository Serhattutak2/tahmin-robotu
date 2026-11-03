// Kaynak denetimi: her baglantiyi bir kez dener, robots.txt kuralini okur. Engeli asmaya calismaz.
import fs from "node:fs";
const list = JSON.parse(fs.readFileSync("config/sources.json", "utf8")), UA = "tahmin-robotu/1.0 (personal research)";
const pause = ms => new Promise(r => setTimeout(r, ms)), robotsCache = new Map();
async function robotsAllows(u) {
  const url = new URL(u);
  if (!robotsCache.has(url.origin)) { let t = null; try { const r = await fetch(`${url.origin}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }); if (r.ok) t = await r.text(); } catch {} robotsCache.set(url.origin, t); }
  const t = robotsCache.get(url.origin); if (!t) return "yok";
  let on = false; const rules = [];
  for (const raw of t.split(/\r?\n/)) { const l = raw.split("#")[0].trim(), m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue; const k = m[1].toLowerCase(); if (k === "user-agent") on = m[2] === "*"; else if (on && (k === "disallow" || k === "allow") && m[2]) rules.push([k, m[2]]); }
  const path = url.pathname + url.search, match = rules.filter(([, p]) => path.startsWith(p.replace(/\*.*$/, ""))).sort((a, b) => b[1].length - a[1].length)[0];
  return match?.[0] === "disallow" ? "yasak" : "izinli";
}
const out = [];
for (const [group, name, url] of list) {
  await pause(800); const e = { group, name, url };
  try { e.robots = await robotsAllows(url); const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000), redirect: "follow" }); e.status = r.status; const b = await r.text(); e.bytes = b.length; e.type = (r.headers.get("content-type") || "").split(";")[0]; e.sample = /json|csv|text\/plain|xml|tab/.test(e.type) ? b.slice(0, 500) : ""; }
  catch (x) { e.status = 0; e.error = String(x.message).slice(0, 80); }
  e.usable = e.status === 200 && e.bytes > 200 && e.robots !== "yasak"; out.push(e);
}
fs.writeFileSync("docs/sources.json", JSON.stringify({ generatedAt: new Date().toISOString(), usable: out.filter(x => x.usable).length, total: out.length, sources: out }, null, 1));
console.log(out.map(x => `${x.usable ? "OK " : "-- "} ${x.status} ${x.robots ?? ""} ${x.bytes ?? ""} ${x.name}`).join("\n"));
