# Oyuncu bazli motor testi (Holmes & McHale 2024 fikri): takim gucu sahaya cikan 11 oyuncunun onceki maclardaki puanlarindan.
# Eksik duzenli oyuncular da hesaba katilir. Yil yil ileri test: her yil yalniz onceki yillarla egitilir.
# Karsilastirma: piyasa (oranlarin ortalamasi) / piyasa + takim / piyasa + kadro / takim + kadro (piyasasiz).
import json, math, collections, numpy as np, pandas as pd, duckdb, lightgbm as lgb
B = "https://huggingface.co/datasets/eatpizzanot/soccer-dataset/resolve/main/"
c = duckdb.connect(); c.execute("INSTALL httpfs; LOAD httpfs; SET threads=4;")
P = lambda t: f"read_parquet('{B}{t}.parquet')"
fx = c.execute(f"SELECT id, date_utc, league_id lg, home_team_id h, away_team_id a, goals_home gh, goals_away ga FROM {P('fixtures')} WHERE is_played AND goals_home IS NOT NULL AND date_utc >= '2016-07-01'").fetchdf()
od = c.execute(f"SELECT fixture_id id, lower(bookmaker) b, home_win o1, draw ox, away_win o2 FROM {P('odds')} WHERE home_win>1 AND draw>1 AND away_win>1").fetchdf()
pl = c.execute(f"""SELECT s.fixture_id id, p.team_id t, s.player_id pid, try_cast(s.games_minutes AS DOUBLE) mins, try_cast(s.games_rating AS DOUBLE) r,
  s.games_substitute sub, s.games_position pos FROM {P('fixture_players_stats_flat')} s JOIN {P('fixture_players')} p ON s.fixture_player_id=p.id""").fetchdf()
print("veri", len(fx), len(od), len(pl), flush=True)
for col in ["id", "lg", "h", "a", "gh", "ga"]: fx[col] = pd.to_numeric(fx[col], errors="coerce")
fx = fx.dropna(subset=["id", "h", "a", "gh", "ga"]); fx["date_utc"] = pd.to_datetime(fx.date_utc); fx = fx.sort_values("date_utc").reset_index(drop=True)
# Sizinti kontrolu (onceki testteki gibi): ayni eslesme 2 gun icinde iki kez ve ayni takimin ayni gun iki maci cikarilir.
fx["gun"] = fx.date_utc.dt.floor("D"); keep = []; seen = {}
for r in fx[["h", "a", "gun"]].itertuples(index=False):
    k = (r.h, r.a); last = seen.get(k)
    if last is not None and (r.gun - last).days <= 2: keep.append(False); continue
    seen[k] = r.gun; keep.append(True)
fx = fx[keep].reset_index(drop=True)
cnt = pd.concat([fx[["h", "gun"]].rename(columns={"h": "t"}), fx[["a", "gun"]].rename(columns={"a": "t"})]).groupby(["t", "gun"]).size()
bad = set(cnt[cnt > 1].index); fx = fx[[((h, g) not in bad and (a, g) not in bad) for h, a, g in zip(fx.h, fx.a, fx.gun)]].reset_index(drop=True)
print("temiz mac", len(fx), flush=True)
for col in ["o1", "ox", "o2"]: od[col] = pd.to_numeric(od[col], errors="coerce")
od["id"] = pd.to_numeric(od.id, errors="coerce")
avg = od.groupby("id")[["o1", "ox", "o2"]].mean(); mx = od.groupby("id")[["o1", "ox", "o2"]].max(); b3 = od[od.b.str.contains("365", na=False)].groupby("id")[["o1", "ox", "o2"]].first()
pl["id"] = pd.to_numeric(pl.id, errors="coerce"); pl["t"] = pd.to_numeric(pl.t, errors="coerce"); pl["pid"] = pd.to_numeric(pl.pid, errors="coerce")
pl["start"] = ~pl["sub"].astype(str).str.lower().isin(["true", "1"]); pl = pl.dropna(subset=["id", "t", "pid"])
G = {k: v for k, v in pl.groupby("id")}
print("oyunculu mac", len(G), flush=True)
# ---- Sirayla: mac oncesi ozellikler, sonra durum guncellemesi ----
A = 0.15; DEF = 6.6
pr = {}            # oyuncu -> [ewma puan, mac sayisi]
reg = collections.defaultdict(lambda: collections.deque(maxlen=8))  # takim -> son 8 macin ilk 11'i
elo = collections.defaultdict(lambda: 1500.0)
rows = []
def side(t, d):
    st = d[(d.t == t) & d.start]
    if len(st) < 9: return None
    vals = []; known = 0; pos = collections.defaultdict(list)
    for p, ps in zip(st.pid, st.pos):
        s = pr.get(p)
        v = s[0] if s and s[1] >= 3 else None
        if v is not None: known += 1
        vals.append(v); pos[str(ps)[:1]].append(v)
    kn = [v for v in vals if v is not None]; base = np.mean(kn) if kn else DEF
    fill = lambda l: np.mean([x if x is not None else base - 0.15 for x in l]) if l else base
    # Duzenli oyuncular: son 8 macta en az 5 kez ilk 11'de olanlar; bu macta yoksa eksik say.
    c8 = collections.Counter(x for lu in reg[t] for x in lu); regs = [p for p, n in c8.items() if n >= 5]
    starting = set(st.pid); miss = [p for p in regs if p not in starting]
    mr = [pr[p][0] for p in miss if p in pr]
    return dict(m=fill(vals), g=fill(pos.get("G", [])), d=fill(pos.get("D", [])), mid=fill(pos.get("M", [])), f=fill(pos.get("F", [])), kn=known, miss=len(miss), missr=(np.mean(mr) - base) if mr else 0.0, misstop=sum(1 for x in mr if x >= base + 0.2))
for r in fx.itertuples(index=False):
    d = G.get(r.id); eh, ea = elo[r.h], elo[r.a]
    if d is not None:
        sh, sa = side(r.h, d), side(r.a, d)
        if sh and sa and r.id in avg.index:
            o = avg.loc[r.id].values; ip = 1 / o; fair = ip / ip.sum()
            row = dict(id=r.id, date=r.date_utc, yr=r.date_utc.year, lg=r.lg, res=0 if r.gh > r.ga else 1 if r.gh == r.ga else 2, gh=r.gh, ga=r.ga, p1=fair[0], px=fair[1], p2=fair[2], elo=eh - ea)
            for k in sh: row["h_" + k] = sh[k]; row["a_" + k] = sa[k]; row["d_" + k] = sh[k] - sa[k]
            if r.id in mx.index: row.update(mx1=mx.loc[r.id, "o1"], mxx=mx.loc[r.id, "ox"], mx2=mx.loc[r.id, "o2"])
            if r.id in b3.index: row.update(b1=b3.loc[r.id, "o1"], bx=b3.loc[r.id, "ox"], b2=b3.loc[r.id, "o2"])
            rows.append(row)
        for x in d.itertuples(index=False):
            if x.mins and x.mins >= 20 and x.r == x.r and x.r:
                s = pr.get(x.pid); pr[x.pid] = [x.r, 1] if not s else [s[0] * (1 - A) + x.r * A, s[1] + 1]
        for t in (r.h, r.a): reg[t].append(set(d[(d.t == t) & d.start].pid))
    exp = 1 / (1 + 10 ** ((ea - eh - 60) / 400)); s = 1 if r.gh > r.ga else 0.5 if r.gh == r.ga else 0
    k = 20 * (1 + abs(r.gh - r.ga)) ** 0.5; elo[r.h] += k * (s - exp); elo[r.a] -= k * (s - exp)
df = pd.DataFrame(rows); print("ozellikli mac", len(df), flush=True)
mk = ["p1", "px", "p2"]; team = ["elo"]; lu = [c for c in df.columns if c.startswith(("h_", "a_", "d_"))]
SETS = {"piyasa": None, "piyasa+takım": mk + team, "piyasa+kadro": mk + team + lu, "takım+kadro (piyasasız)": team + lu, "sadece takım (piyasasız)": team}
def rps(P, y):
    Y = np.eye(3)[y]; c1 = np.cumsum(P, 1)[:, :2]; c2 = np.cumsum(Y, 1)[:, :2]; return float(np.mean(np.sum((c1 - c2) ** 2, 1) / 2))
out = {"maç": len(df), "yıllar": {}, "bahis": {}}; preds = []
for Y in sorted(df.yr.unique()):
    if Y < 2020: continue
    tr, te = df[df.yr < Y], df[df.yr == Y]
    if len(tr) < 20000 or len(te) < 1000: continue
    y = te.res.values.astype(int); res = {"maç": len(te)}; Pc = None
    for name, cols in SETS.items():
        if cols is None: Pp = te[mk].values
        else:
            m = lgb.train(dict(objective="multiclass", num_class=3, learning_rate=0.03, num_leaves=31, min_data_in_leaf=300, feature_fraction=0.8, verbose=-1), lgb.Dataset(tr[cols], tr.res.astype(int)), 400)
            Pp = m.predict(te[cols])
        if name == "piyasa+kadro": Pc = Pp
        res[name] = {"rps": round(rps(Pp, y), 5), "isabet": round(float(np.mean(Pp.argmax(1) == y)), 4)}
    out["yıllar"][str(Y)] = res; print(Y, res, flush=True)
    t2 = te.copy(); t2[["q1", "qx", "q2"]] = Pc; preds.append(t2)
pd_ = pd.concat(preds)
def bets(d, src, edge, cond=None):
    v = []
    for r in d.itertuples(index=False):
        if cond is not None and not cond(r): continue
        q = [r.q1, r.qx, r.q2]; o = [getattr(r, src + "1", None), getattr(r, src + "x", None), getattr(r, src + "2", None)]
        best = None
        for i in range(3):
            if o[i] is None or o[i] != o[i] or o[i] < 1.3 or o[i] > 5: continue
            ev = q[i] * o[i] - 1
            if ev >= edge and (best is None or ev > best[0]): best = (ev, i, o[i])
        if best: v.append(best[2] - 1 if best[1] == r.res else -1)
    if not v: return {"seçim": 0}
    v = np.array(v); se = v.std() / math.sqrt(len(v))
    return {"seçim": len(v), "tutan": int((v > 0).sum()), "kar": round(float(v.sum()), 1), "getiri100": round(float(v.mean() * 100), 1), "alt100": round(float((v.mean() - 1.96 * se) * 100), 1), "üst100": round(float((v.mean() + 1.96 * se) * 100), 1)}
for src, nm in [("mx", "enYüksek"), ("b", "bet365")]:
    for e in [0.02, 0.05, 0.08]:
        out["bahis"][f"{nm}|{e}"] = bets(pd_, src, e)
        out["bahis"][f"{nm}|{e}|eksikYıldızVar"] = bets(pd_, src, e, lambda r: r.h_misstop + r.a_misstop >= 1)
        print(nm, e, out["bahis"][f"{nm}|{e}"], out["bahis"][f"{nm}|{e}|eksikYıldızVar"], flush=True)
json.dump(out, open("docs/hfplayers.json", "w"), ensure_ascii=False, indent=1, default=str)
