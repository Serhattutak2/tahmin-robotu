// Ucretsiz haber taramasi (Google News RSS). Anahtar gerektirmez; basliklar yalnizca bilgi amaclidir, olasiligi degistirmez.
import { getText } from "./sources.mjs";
const decode = s => String(s).replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
export function parseRss(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const tag = t => decode(m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] || "");
    return { title: tag("title"), url: tag("link"), date: tag("pubDate"), source: tag("source") };
  }).filter(x => x.title && /^https?:/.test(x.url));
}
const INJ = /injur|doubt|ruled out|suspend|sidelined|misses|sakat|cezal|kadro d[ıi]ş/i, PRED = /predict|preview|betting|tips?\b|odds|tahmin|picks?\b/i;
export function classify(items) { return { injury: items.filter(i => INJ.test(i.title)).length, prediction: items.filter(i => PRED.test(i.title)).length, total: items.length }; }
export async function matchNews(home, away) {
  const q = encodeURIComponent(`"${home}" "${away}" when:5d`);
  const items = parseRss(await getText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, 2)).slice(0, 12);
  const c = classify(items);
  const top = [...items.filter(i => INJ.test(i.title)), ...items.filter(i => PRED.test(i.title) && !INJ.test(i.title)), ...items].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
  return { date: new Date().toISOString().slice(0, 10), summary: c.total ? `Son 5 günde ${c.total} haber bulundu: ${c.injury} tanesi sakatlık/ceza, ${c.prediction} tanesi tahmin/önizleme başlıklı. Başlıklar otomatik tarandı, olasılığa dahil edilmedi.` : "Son 5 günde bu maçla ilgili haber bulunamadı.", counts: c, sources: top.map(i => ({ title: i.source ? `${i.title} (${i.source})` : i.title, url: i.url })) };
}
