# Tek motor bilimsel testi: 640 bin maclik acik veri, xG, sut, oyuncu puani, teknik direktor, Elo, dinlenme, lig.
# Yil yil ileri test: her yil yalniz onceki yillarla egitilir. Kar yalniz gercek oranlarla olculur.
import json, numpy as np, pandas as pd, duckdb, lightgbm as lgb
B = "https://huggingface.co/datasets/eatpizzanot/soccer-dataset/resolve/main/"
c = duckdb.connect(); c.execute("INSTALL httpfs; LOAD httpfs; SET threads=4;")
P = lambda t: f"read_parquet('{B}{t}.parquet')"
fx = c.execute(f"SELECT id, date_utc, league_id, home_team_id h, away_team_id a, goals_home gh, goals_away ga FROM {P('fixtures')} WHERE is_played AND goals_home IS NOT NULL AND date_utc >= '2016-07-01'").fetchdf()
st = c.execute(f"SELECT fixture_id id, home_xg, away_xg, home_shots_total hs, away_shots_total \"as\", home_shots_on_goal hst, away_shots_on_goal ast, home_corners hc, away_corners ac, home_possession hp, away_possession ap, home_pass_accuracy hpa, away_pass_accuracy apa, home_red_cards hr, away_red_cards ar FROM {P('match_stats')}").fetchdf()
od = c.execute(f"SELECT fixture_id id, lower(bookmaker) b, home_win o1, draw ox, away_win o2 FROM {P('odds')} WHERE home_win>1 AND draw>1 AND away_win>1").fetchdf()
coach = c.execute(f"SELECT fixture_id id, team_id t, any_value(coach_name) coach FROM {P('fixture_lineups')} GROUP BY 1,2").fetchdf()
try:
    rate = c.execute(f"SELECT p.fixture_id id, p.team_id t, avg(try_cast(s.games_rating AS DOUBLE)) r FROM {P('fixture_players_stats_flat')} s JOIN {P('fixture_players')} p ON s.fixture_player_id=p.id WHERE try_cast(s.games_minutes AS DOUBLE)>=45 GROUP BY 1,2").fetchdf()
except Exception as e:
    print("oyuncu verisi yok", str(e)[:200]); rate = pd.DataFrame(columns=["id","t","r"])
print(len(fx), len(st), len(od), len(coach), len(rate), flush=True)
fair = od.groupby("id")[["o1","ox","o2"]].mean().add_prefix("avg_"); mx = od.groupby("id")[["o1","ox","o2"]].max().add_prefix("max_"); n = od.groupby("id").size().rename("nb")
b365 = od[od.b.str.contains("365", na=False)].groupby("id")[["o1","ox","o2"]].first().add_prefix("b_")
df = fx.merge(st, on="id", how="left").join(fair, on="id").join(mx, on="id").join(n, on="id").join(b365, on="id")
df["date_utc"] = pd.to_datetime(df.date_utc); df = df.sort_values("date_utc").reset_index(drop=True)
rt = rate.set_index(["id","t"]).r.to_dict() if len(rate) else {}; ch = coach.set_index(["id","t"]).coach.to_dict()
# Kronolojik: mac oncesi takim durumu, mac sonrasi guncelleme.
A = .12
class T:
    __slots__ = ("elo","n","gf","ga","xf","xa","sf","sa","sotf","sota","cf","pos","pas","rat","last","coach","cg","vh","va","pts")
    def __init__(s): s.elo=1500.;s.n=0;s.gf=1.3;s.ga=1.3;s.xf=1.3;s.xa=1.3;s.sf=12.;s.sa=12.;s.sotf=4.;s.sota=4.;s.cf=5.;s.pos=50.;s.pas=78.;s.rat=6.8;s.last=None;s.coach=None;s.cg=0;s.vh=1.3;s.va=1.1;s.pts=[]
teams = {}; rows = []; lg = {}
def ema(o,k,v):
    if v is not None and not (isinstance(v,float) and np.isnan(v)): setattr(o,k,getattr(o,k)*(1-A)+float(v)*A)
for r in df.itertuples(index=False):
    H=teams.setdefault(r.h,T()); W=teams.setdefault(r.a,T()); L=lg.setdefault(r.league_id,{"g":2.7,"h":.44,"d":.26})
    d=r.date_utc; ch_h=ch.get((r.id,r.h)); ch_a=ch.get((r.id,r.a))
    rest=lambda t:(min((d-t.last).days,21) if t.last is not None else 7)
    ppg=lambda t:(sum(t.pts[-5:])/max(len(t.pts[-5:]),1))
    rows.append((H.elo-W.elo,min(H.n,W.n),H.gf,H.ga,W.gf,W.ga,H.xf,H.xa,W.xf,W.xa,H.sf,H.sa,W.sf,W.sa,H.sotf,H.sota,W.sotf,W.sota,H.cf,W.cf,H.pos,W.pos,H.pas,W.pas,H.rat,W.rat,rest(H),rest(W),ppg(H),ppg(W),H.vh,W.va,min(H.cg,30),min(W.cg,30),L["g"],L["h"],L["d"]))
    gh,ga=float(r.gh),float(r.ga); E=1/(1+10**(-(H.elo+60-W.elo)/400)); res=1 if gh>ga else .5 if gh==ga else 0; k=20*(np.log(abs(gh-ga)+1) or 1); H.elo+=k*(res-E); W.elo-=k*(res-E)
    for o,f,g,x,xa,s,sa,so,soa,co,po,pa,tid,cn in ((H,gh,ga,r.home_xg,r.away_xg,r.hs,r.as_ if hasattr(r,"as_") else None,r.hst,r.ast,r.hc,r.hp,r.hpa,r.h,ch_h),(W,ga,gh,r.away_xg,r.home_xg,None,r.hs,r.ast,r.hst,r.ac,r.ap,r.apa,r.a,ch_a)):
        ema(o,"gf",f);ema(o,"ga",g);ema(o,"xf",x if x==x and x is not None else None);ema(o,"xa",xa if xa==xa and xa is not None else None);ema(o,"sotf",so);ema(o,"sota",soa);ema(o,"cf",co);ema(o,"pos",po);ema(o,"pas",pa)
        ra=rt.get((r.id,tid)); ema(o,"rat",ra); o.n+=1;o.last=d;o.pts.append(3 if f>g else 1 if f==g else 0);o.pts=o.pts[-5:]
        if cn and cn==o.coach:o.cg+=1
        elif cn:o.coach=cn;o.cg=0
    H.vh=H.vh*.9+gh*.1;W.va=W.va*.9+ga*.1;L["g"]=L["g"]*.995+(gh+ga)*.005;L["h"]=L["h"]*.995+(gh>ga)*.005;L["d"]=L["d"]*.995+(gh==ga)*.005
NAMES=["elo_fark","az_mac","ev_gol","ev_yenilen","dep_gol","dep_yenilen","ev_xg","ev_xg_yenilen","dep_xg","dep_xg_yenilen","ev_sut","ev_sut_yenilen","dep_sut","dep_sut_yenilen","ev_isabet","ev_isabet_yenilen","dep_isabet","dep_isabet_yenilen","ev_korner","dep_korner","ev_top","dep_top","ev_pas","dep_pas","ev_oyuncu_puani","dep_oyuncu_puani","ev_dinlenme","dep_dinlenme","ev_form","dep_form","ev_saha_gol","dep_saha_gol","ev_hoca_mac","dep_hoca_mac","lig_gol","lig_ev","lig_ber"]
X=pd.DataFrame(rows,columns=NAMES); X["lig"]=df.league_id.astype("category").cat.codes
y=np.where(df.gh>df.ga,0,np.where(df.gh==df.ga,1,2)); yr=df.date_utc.dt.year.values
ok=(X.az_mac>=8).values&df.avg_o1.notna().values
mk=np.c_[1/df.avg_o1,1/df.avg_ox,1/df.avg_o2]; mk=mk/np.nansum(mk,axis=1,keepdims=True)
rps=lambda p,yy:np.mean(((np.cumsum(p,1)[:,:2]-np.cumsum(np.eye(3)[yy],1)[:,:2])**2).sum(1)/2)
par=dict(objective="multiclass",num_class=3,learning_rate=.04,num_leaves=31,min_data_in_leaf=300,feature_fraction=.7,bagging_fraction=.8,bagging_freq=1,lambda_l2=20,verbose=-1,seed=7)
res=[];imp={};O=[]
for Y in [2022,2023,2024,2025,2026]:
    tr=np.where((yr<Y)&ok)[0];te=np.where((yr==Y)&ok)[0]
    if len(te)<100: continue
    cut=int(len(tr)*.88);a,b=tr[:cut],tr[cut:]
    off=np.log(np.clip(mk,1e-4,1))
    # Saf istatistik
    d1=lgb.Dataset(X.iloc[a],y[a],free_raw_data=False);d2=lgb.Dataset(X.iloc[b],y[b],reference=d1,free_raw_data=False)
    m1=lgb.train(par,d1,600,[d2],callbacks=[lgb.early_stopping(40,verbose=False)]);p1=m1.predict(X.iloc[te])
    # Piyasanin ustune duzeltme
    d3=lgb.Dataset(X.iloc[a],y[a],init_score=off[a].ravel(order="F"),free_raw_data=False);d4=lgb.Dataset(X.iloc[b],y[b],init_score=off[b].ravel(order="F"),reference=d3,free_raw_data=False)
    m2=lgb.train({**par,"learning_rate":.02,"num_leaves":15,"lambda_l2":50},d3,400,[d4],callbacks=[lgb.early_stopping(30,verbose=False)])
    raw=m2.predict(X.iloc[te],raw_score=True)+off[te];p2=np.exp(raw)/np.exp(raw).sum(1,keepdims=True)
    for nm,g in zip(NAMES+["lig"],m1.feature_importance("gain")): imp[nm]=imp.get(nm,0)+float(g)
    O.append(pd.DataFrame({"i":te,"y":y[te],"yr":Y,**{f"s{k}":p1[:,k] for k in range(3)},**{f"r{k}":p2[:,k] for k in range(3)},**{f"m{k}":mk[te,k] for k in range(3)}}))
    res.append(dict(yıl=Y,maç=int(len(te)),rps=dict(istatistik=round(float(rps(p1,y[te])),5),düzeltme=round(float(rps(p2,y[te])),5),piyasa=round(float(rps(mk[te],y[te])),5)),isabet=dict(istatistik=round(float((p1.argmax(1)==y[te]).mean()),4),düzeltme=round(float((p2.argmax(1)==y[te]).mean()),4),piyasa=round(float((mk[te].argmax(1)==y[te]).mean()),4)),tur=m2.best_iteration))
    print(res[-1],flush=True)
O=pd.concat(O).reset_index(drop=True)
ent={"bet365":np.c_[df.b_o1,df.b_ox,df.b_o2],"ortalama":np.c_[df.avg_o1,df.avg_ox,df.avg_o2],"enYuksek":np.c_[df.max_o1,df.max_ox,df.max_o2]*.96}
def bets(sub,src,e,edge,lo=1.2,hi=4):
    q=sub[[f"{src}{k}" for k in range(3)]].values;o=ent[e][sub.i.values];ev=q*o-1;ev[np.isnan(ev)|(o<lo)|(o>hi)]=-9;k=ev.argmax(1);pick=ev.max(1)>=edge;oo=o[np.arange(len(k)),k][pick];w=k[pick]==sub.y.values[pick];v=np.where(w,oo-1,-1.);return v,oo,sub.yr.values[pick],k[pick]
def st(v,oo=None):
    if not len(v):return dict(seçim=0)
    rr=v.mean();se=v.std()/np.sqrt(len(v));return dict(seçim=int(len(v)),tutan=int((v>0).sum()),kar=round(float(v.sum()),1),g100=round(float(rr*100),1),alt=round(float((rr-1.96*se)*100),1),üst=round(float((rr+1.96*se)*100),1),oran=round(float(oo.mean()),2) if oo is not None else None)
G=[(s,e,x) for s in("r","s") for e in ent for x in(.02,.03,.05,.08,.12,.2)]
wf={};rows2=[]
for s in("r","s"):
    for e in ent:
        V=[];OO=[]
        for Y in sorted(O.yr.unique()):
            past=O[O.yr<Y]
            if len(past)<3000: continue
            best=max(((x,bets(past,s,e,x)[0]) for x in(.02,.03,.05,.08,.12,.2)),key=lambda t:(t[1].mean() if len(t[1])>=150 else -9))
            v,oo,_,_=bets(O[O.yr==Y],s,e,best[0]);V.append(v);OO.append(oo);rows2.append(dict(tür={"r":"düzeltme","s":"istatistik"}[s],oran=e,yıl=int(Y),eşik=best[0],**st(v,oo)))
        if V: wf[f"{ {'r':'düzeltme','s':'istatistik'}[s] }|{e}"]=st(np.concatenate(V),np.concatenate(OO))
rep=dict(toplamMaç=int(len(df)),testMaç=int(len(O)),yıllar=res,ilerleyenKar=wf,yılKar=rows2,önem=sorted(imp.items(),key=lambda x:-x[1])[:20],veri=dict(xgMaç=int(df.home_xg.notna().sum()),oyuncuPuanı=int(len(rate))))
json.dump(rep,open("docs/hfmodel.json","w"),ensure_ascii=False,indent=1);print(json.dumps(rep["ilerleyenKar"],ensure_ascii=False))
