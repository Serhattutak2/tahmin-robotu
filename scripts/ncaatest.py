# NCAA erkek basketbol: tempo x verimlilik modeli (KenPom/Torvik tarzi) ve gecmis cizgilerle ileriye donuk test.
# Veri: sportsdataverse ESPN takim kutu skorlari (2022-bugun), zachmayer/point_spreads cizgileri (handikap + toplam).
# Model her maci yalnizca o tarihten onceki maclarla tahmin eder. Esik ve kucultme katsayisi eski sezonlarda secilir,
# sonraki sezonlarda sadece raporlanir.
import gzip, io, json, math, re, sys, urllib.request, os, difflib
from collections import defaultdict
import pandas as pd

SEASONS = [2022, 2023, 2024, 2025, 2026, 2027]
BOX = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/ncaa_mbb_team_box/ncaa_mbb_team_box_{}.csv.gz"
LINES = "https://raw.githubusercontent.com/zachmayer/point_spreads/HEAD/data/spreads_and_totals.csv"
out = {}

def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "tahmin-robotu"}), timeout=120) as r:
        return r.read()

SCHED = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/ncaa_mbb_schedule/ncaa_mbb_schedule_{}.csv.gz"
frames, sfr = [], []
for s in SEASONS:
    try:
        b = pd.read_csv(io.BytesIO(gzip.decompress(get(BOX.format(s)))), low_memory=False); b["season"] = s; frames.append(b)
        c = pd.read_csv(io.BytesIO(gzip.decompress(get(SCHED.format(s)))), low_memory=False); c["season"] = s; sfr.append(c)
        print(s, len(b), len(c), file=sys.stderr)
    except Exception as e:
        print("fail", s, e, file=sys.stderr)
box = pd.concat(frames, ignore_index=True); sch = pd.concat(sfr, ignore_index=True)
out["schedColumns"] = list(sch.columns)
print("SCHED", list(sch.columns), sch.iloc[0].to_dict(), file=sys.stderr)
key = "contest_id" if "contest_id" in sch.columns else [c for c in sch.columns if "id" in c.lower()][0]
dcol = next(c for c in ("game_date", "date", "start_date", "game_date_time", "start_time_epoch") if c in sch.columns) if any(c in sch.columns for c in ("game_date", "date", "start_date", "game_date_time")) else [c for c in sch.columns if "date" in c.lower()][0]
ncol = next((c for c in sch.columns if "neutral" in c.lower()), None)
dateOf = {}; neutOf = {}
for r in sch[[key, dcol] + ([ncol] if ncol else [])].itertuples(index=False):
    dateOf[r[0]] = str(r[1]); neutOf[r[0]] = bool(r[2]) if ncol and str(r[2]).lower() in ("true", "1", "1.0", "yes") else False
def toDate(v):
    v = str(v)
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", v)
    if m: return m.group(0)
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", v)
    if m: return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return None
box = box.dropna(subset=["pts", "d_pts", "o_poss"])
games, seen = [], set()
for r in box.itertuples(index=False):
    if r.team != r.home or r.contest_id in seen: continue
    seen.add(r.contest_id)
    d = toDate(dateOf.get(r.contest_id, ""))
    if not d or not (40 < float(r.o_poss) < 110): continue
    games.append(dict(gid=int(r.contest_id), season=int(r.season), date=d, home=str(r.home), away=str(r.away), hid=str(r.home), aid=str(r.away), hn=str(r.home), an=str(r.away),
                      hs=float(r.pts), as_=float(r.d_pts), poss=(float(r.o_poss) + float(r.d_poss)) / 2, neutral=neutOf.get(r.contest_id, False)))
games.sort(key=lambda z: (z["date"], z["gid"]))
out["games"] = len(games)
out["neutralGames"] = sum(1 for z in games if z["neutral"])
print("games", len(games), games[:2], file=sys.stderr)

# ---- cizgiler ve isim eslestirme
lines = pd.read_csv(io.BytesIO(get(LINES)))
out["lineColumns"] = list(lines.columns)
lines["game_date"] = lines["game_date"].astype(str).str[:10]
lines = lines[lines["game_date"] >= "2021-11-01"]
out["lineRows"] = len(lines)

def norm(s):
    s = str(s).lower().replace("&", " and ")
    for a, b in (("ga.", "georgia"), ("fla.", "florida"), ("so.", "southern"), ("n.c.", "north carolina"), ("ark.", "arkansas"), ("ky.", "kentucky"), ("la.", "louisiana"), ("miss.", "mississippi"), ("tenn.", "tennessee"), ("ala.", "alabama"), ("mich.", "michigan"), ("ill.", "illinois"), ("ind.", "indiana"), ("wash.", "washington"), ("colo.", "colorado"), ("ariz.", "arizona"), ("okla.", "oklahoma"), ("tex.", "texas"), ("mo.", "missouri"), ("conn.", "connecticut"), ("mass.", "massachusetts"), ("caro.", "carolina"), ("ky ", "kentucky "), ("ga ", "georgia ")):
        s = s.replace(a, b + " ")
    s = re.sub(r"\bst\.?\b", "state", s)
    s = re.sub(r"\buniv(ersity)?\b|\bof\b|\bthe\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return " ".join(s.split())

def sim(a, b):
    a, b = norm(a), norm(b)
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()

byDate = defaultdict(list)
for i, z in enumerate(games):
    byDate[z["date"]].append(i)
lineOf = {}
matched = 0
for r in lines.itertuples(index=False):
    best, bs = None, 0
    for d in {r.game_date}:
        for i in byDate.get(d, []):
            z = games[i]
            s1 = (max(sim(r.home_team, z["home"]), sim(r.home_team, z["hn"])) + max(sim(r.away_team, z["away"]), sim(r.away_team, z["an"]))) / 2
            s2 = (max(sim(r.home_team, z["away"]), sim(r.home_team, z["an"])) + max(sim(r.away_team, z["home"]), sim(r.away_team, z["hn"]))) / 2
            s, flip = (s1, False) if s1 >= s2 else (s2, True)
            if s > bs:
                best, bs, bf = i, s, flip
    if best is not None and bs >= 0.78 and best not in lineOf:
        sp = float(r.spread) if pd.notna(r.spread) else None
        to = float(r.total) if pd.notna(r.total) else None
        # spread: ev sahibi acisindan (eksi = ev sahibi favori) varsayilir; flip ise isaret degisir
        lineOf[best] = dict(spread=(-sp if bf else sp) if sp is not None else None, total=to)
        matched += 1
out["matched"] = matched

# ---- isaret yonunu veriden ogren: spread, ev sahibi marjiyla negatif mi pozitif mi iliskili?
xs = [(lineOf[i]["spread"], games[i]["hs"] - games[i]["as_"]) for i in lineOf if lineOf[i]["spread"] is not None]
corr = sum(a * b for a, b in xs) / max(1, len(xs))
SIGN = -1 if corr < 0 else 1  # margin_pred_by_line = SIGN * spread
out["spreadSign"] = SIGN

# ---- model
def run(lr=0.06, lrT=0.05, hca=3.2, carry=0.6):
    O, D, T = defaultdict(lambda: None), defaultdict(lambda: None), defaultdict(lambda: None)
    seasonAvg = {}
    cnt = defaultdict(int)
    recs = []
    cur = None
    avgE, avgT = 104.0, 68.0
    for i, z in enumerate(games):
        if z["season"] != cur:
            # sezon gecisi: puanlar ortalamaya dogru cekilir
            for dct, m in ((O, avgE), (D, avgE), (T, avgT)):
                for k in list(dct.keys()):
                    dct[k] = m + carry * (dct[k] - m)
            cnt = defaultdict(int)
            cur = z["season"]
        h, a = z["hid"], z["aid"]
        for t in (h, a):
            if O[t] is None:
                O[t], D[t], T[t] = avgE - 4, avgE + 4, avgT  # yeni/kucuk takim: ortalamanin altinda
        hadj = 0 if z["neutral"] else hca / 2
        ph = O[h] * D[a] / avgE + hadj
        pa = O[a] * D[h] / avgE - hadj
        tp = T[h] * T[a] / avgT
        predTot = (ph + pa) * tp / 100
        predMar = (ph - pa) * tp / 100
        n = min(cnt[h], cnt[a])
        if i in lineOf:
            L = lineOf[i]
            recs.append(dict(i=i, season=z["season"], date=z["date"], n=n, pt=predTot, pm=predMar, lt=L["total"], ls=(SIGN * L["spread"]) if L["spread"] is not None else None,
                             at=z["hs"] + z["as_"], am=z["hs"] - z["as_"]))
        # guncelleme
        eh = 100 * z["hs"] / z["poss"] - hadj
        ea = 100 * z["as_"] / z["poss"] + hadj
        rh, ra = eh - O[h] * D[a] / avgE, ea - O[a] * D[h] / avgE
        O[h] += lr * rh; D[a] += lr * rh; O[a] += lr * ra; D[h] += lr * ra
        rt = z["poss"] - tp
        T[h] += lrT * rt; T[a] += lrT * rt
        avgE += 0.002 * ((eh + ea) / 2 - avgE)
        avgT += 0.002 * (z["poss"] - avgT)
        cnt[h] += 1; cnt[a] += 1
    return recs

def Phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def fitk(rs, key):
    # (gercek - cizgi) = k * (model - cizgi)
    num = den = 0
    for r in rs:
        L = r["lt"] if key == "t" else r["ls"]
        if L is None:
            continue
        m = r["pt"] if key == "t" else r["pm"]
        y = (r["at"] if key == "t" else r["am"]) - L
        num += (m - L) * y; den += (m - L) ** 2
    return num / den if den else 0

def bets(rs, key, k, sig, minEdge, minN, odds=1.91):
    res = []
    for r in rs:
        L = r["lt"] if key == "t" else r["ls"]
        if L is None or r["n"] < minN:
            continue
        m = r["pt"] if key == "t" else r["pm"]
        fair = L + k * (m - L)
        edge = fair - L
        if abs(edge) < minEdge:
            continue
        actual = (r["at"] if key == "t" else r["am"]) - L
        if actual == 0:
            continue
        won = (actual > 0) == (edge > 0)
        res.append((r["season"], won, edge, r))
    return res

def summ(bs, odds=1.91):
    n = len(bs); w = sum(1 for b in bs if b[1])
    return dict(n=n, isabet=round(w / n * 100, 1) if n else None, kar=round(w * (odds - 1) - (n - w), 1), getiri100=round((w * (odds - 1) - (n - w)) / n * 100, 1) if n else None)

results = {}
best = None
TRAIN = {2022, 2023, 2024}
for lr in (0.04, 0.06, 0.09):
    for carry in (0.5, 0.7):
        recs = run(lr=lr, carry=carry)
        tr = [r for r in recs if r["season"] in TRAIN]
        mae = lambda rs, a, b: sum(abs(r[a] - r[b]) for r in rs if r[a] is not None and r[b] is not None) / max(1, sum(1 for r in rs if r[a] is not None and r[b] is not None))
        key = f"lr{lr}_c{carry}"
        results[key] = dict(maeModelTot=round(mae(tr, "pt", "at"), 2), maeLineTot=round(mae(tr, "lt", "at"), 2), maeModelMar=round(mae(tr, "pm", "am"), 2), maeLineMar=round(mae(tr, "ls", "am"), 2))
        score = results[key]["maeModelTot"] + results[key]["maeModelMar"]
        if best is None or score < best[0]:
            best = (score, lr, carry, recs)
_, lr, carry, recs = best
out["modelGrid"] = results
out["chosen"] = dict(lr=lr, carry=carry)

tr = [r for r in recs if r["season"] in TRAIN]
kt, ks = fitk(tr, "t"), fitk(tr, "s")
out["k"] = dict(toplam=round(kt, 3), handikap=round(ks, 3))
# ham k'lar sezon sezon (kucultmenin kararliligi)
out["kBySeason"] = {s: dict(toplam=round(fitk([r for r in recs if r["season"] == s], "t"), 3), handikap=round(fitk([r for r in recs if r["season"] == s], "s"), 3)) for s in SEASONS}

grid = {}
for key, kk in (("t", kt), ("s", ks)):
    for minEdge in (1.0, 1.5, 2.0, 2.5, 3.0, 4.0):
        for minN in (0, 5, 10):
            b = bets(recs, key, kk, 16 if key == "t" else 10.75, minEdge, minN)
            row = {"egitim": summ([x for x in b if x[0] in TRAIN])}
            for s in SEASONS:
                if s not in TRAIN:
                    row[str(s)] = summ([x for x in b if x[0] == s])
            row["test"] = summ([x for x in b if x[0] not in TRAIN])
            grid[f"{'toplam' if key == 't' else 'handikap'} kenar>={minEdge} maç>={minN}"] = row
out["grid"] = grid

# yon kirilimi: alt/ust
def split(key, kk, minEdge, minN):
    b = bets(recs, key, kk, 16, minEdge, minN)
    return {"alt": summ([x for x in b if x[2] < 0 and x[0] not in TRAIN]), "ust": summ([x for x in b if x[2] > 0 and x[0] not in TRAIN]),
            "alt_egitim": summ([x for x in b if x[2] < 0 and x[0] in TRAIN]), "ust_egitim": summ([x for x in b if x[2] > 0 and x[0] in TRAIN])}
out["toplamYon"] = {f"kenar>={e}": split("t", kt, e, 5) for e in (1.5, 2.0, 3.0)}

# canli kullanim icin son reytingler
os.makedirs("data", exist_ok=True)
json.dump(dict(games=[dict(d=z["date"], s=z["season"], h=z["hid"], a=z["aid"], hn=z["home"], an=z["away"], hs=z["hs"], as_=z["as_"], p=round(z["poss"], 1), n=z["neutral"]) for z in games]), open("data/ncaa_games.json", "w"))
json.dump(out, open("docs/ncaatest.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: out[k] for k in ("games", "lineRows", "matched", "spreadSign", "chosen", "k")}, ensure_ascii=False))
