# Oyun anlarindan mac basina takim istatistigi: sayi, sut denemesi, serbest atis denemesi, hucum ribaundu, top kaybi -> hucum sayisi.
import csv, json, sys, glob, collections
csv.field_size_limit(10**9)
TRI = {"ATL":"hawks","BOS":"celtics","BKN":"nets","CHA":"hornets","CHI":"bulls","CLE":"cavaliers","DAL":"mavericks","DEN":"nuggets","DET":"pistons","GSW":"warriors","HOU":"rockets","IND":"pacers","LAC":"clippers","LAL":"lakers","MEM":"grizzlies","MIA":"heat","MIL":"bucks","MIN":"timberwolves","NOP":"pelicans","NYK":"knicks","OKC":"thunder","ORL":"magic","PHI":"76ers","PHX":"suns","POR":"blazers","SAC":"kings","SAS":"spurs","TOR":"raptors","UTA":"jazz","WAS":"wizards"}
G = {}
for f in sorted(glob.glob("cdnnba_*.csv")):
    for r in csv.DictReader(open(f, newline="")):
        gid = r["gameId"]; g = G.setdefault(gid, {"t": {}, "start": None, "home": None, "sh": 0, "sa": 0, "po": "_po_" in f})
        if g["start"] is None and r["timeActual"]: g["start"] = r["timeActual"]
        try: sh, sa = int(float(r["scoreHome"] or 0)), int(float(r["scoreAway"] or 0))
        except: sh, sa = g["sh"], g["sa"]
        tri = r["teamTricode"]
        if tri in TRI:
            s = g["t"].setdefault(tri, collections.Counter())
            at, sub = r["actionType"], r["subType"]
            if at in ("2pt", "3pt"): s["fga"] += 1
            elif at == "freethrow": s["fta"] += 1
            elif at == "rebound" and sub == "offensive": s["orb"] += 1
            elif at == "turnover": s["tov"] += 1
            if g["home"] is None and (sh > g["sh"] or sa > g["sa"]) and r.get("shotResult") == "Made": g["home"] = tri if sh > g["sh"] else ("AWAY", tri)
        if sh >= g["sh"]: g["sh"] = sh
        if sa >= g["sa"]: g["sa"] = sa
out = []
for gid, g in G.items():
    tris = [t for t in g["t"] if t in TRI]
    if len(tris) != 2 or g["home"] is None: continue
    if isinstance(g["home"], tuple): away = g["home"][1]; home = [t for t in tris if t != away][0]
    else: home = g["home"]; away = [t for t in tris if t != home][0]
    def poss(s): return s["fga"] - s["orb"] + s["tov"] + 0.44 * s["fta"]
    H, A = g["t"][home], g["t"][away]
    out.append({"id": gid, "day": (g["start"] or "")[:10], "po": g["po"], "h": TRI[home], "a": TRI[away], "hs": g["sh"], "as": g["sa"], "ph": round(poss(H), 1), "pa": round(poss(A), 1)})
out.sort(key=lambda x: x["day"])
json.dump(out, open("nbabox.json", "w"))
print(len(out), out[0], out[-1])
