import fs from "node:fs";
const H = { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "tahmin-robotu" } }, out = {};
const gj = async u => (await fetch(u, H)).json();
const rels = []; for (let p = 1; p < 15; p++) { const a = await gj(`https://api.github.com/repos/sportsdataverse/sportsdataverse-data/releases?per_page=100&page=${p}`); if (!Array.isArray(a) || !a.length) break; rels.push(...a); }
out.rels = rels.filter(r => /college_basketball|mbb/i.test(r.tag_name)).map(r => ({ tag: r.tag_name, assets: r.assets.filter(a => /20(2[2-7])/.test(a.name)).map(a => a.name + " " + Math.round(a.size / 1024) + "KB").slice(0, 30) }));
out.allTags = rels.map(r => r.tag_name);
const tree = await gj("https://api.github.com/repos/zachmayer/point_spreads/git/trees/HEAD?recursive=1");
out.ps = (tree.tree || []).map(x => x.path + " " + (x.size || "")).slice(0, 200);
fs.writeFileSync("docs/ncaaprobe.json", JSON.stringify(out, null, 1));
