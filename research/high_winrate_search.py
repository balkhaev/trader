#!/usr/bin/env python3
"""Public-data-only Binance USD-M strategy search. No credentials, no orders."""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, heapq, itertools, json, math, random, time
import urllib.error, urllib.request, zipfile
from pathlib import Path
import numpy as np
import pandas as pd
from numba import njit

SYMS=("BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","LINKUSDT","AVAXUSDT","WIFUSDT")
START=pd.Timestamp("2023-01-01",tz="UTC"); V0=pd.Timestamp("2024-07-01",tz="UTC")
T0=pd.Timestamp("2025-07-01",tz="UTC"); H0=pd.Timestamp("2026-04-01",tz="UTC"); END=pd.Timestamp("2026-07-01",tz="UTC")
URL="https://data.binance.vision/data/futures/um/monthly/klines/{s}/15m/{s}-15m-{y:04d}-{m:02d}.zip"
COLS=["ts","open","high","low","close","volume","close_ts","quote","trades","taker_base","taker_quote","ignore"]
COST=0.0012; RISK=0.0015; CAP=.25; MAX_OPEN=4; SEED=20260730
DT=np.dtype([("si","i8"),("ei","i8"),("xi","i8"),("side","i1"),("entry","f8"),("exit","f8"),("gross","f8"),("stop","f8"),("why","i1")])

def months(): return list(pd.date_range(START,END-pd.offsets.MonthBegin(1),freq="MS",tz="UTC"))
def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"trader-research/1.0"}),timeout=45) as r:return r.read()
        except urllib.error.HTTPError as e:
            if e.code==404:return None
            if i==tries-1:raise
        except Exception:
            if i==tries-1:raise
        time.sleep(1+i)

def dl_one(x):
    s,mo,root=x; d=root/s; d.mkdir(parents=True,exist_ok=True); p=d/f"{s}-15m-{mo.year:04d}-{mo.month:02d}.zip"
    if p.exists() and p.stat().st_size>100:return s,mo.strftime("%Y-%m"),"cached",p.stat().st_size
    b=get(URL.format(s=s,y=mo.year,m=mo.month))
    if b is None:return s,mo.strftime("%Y-%m"),"missing",0
    if not b.startswith(b"PK"):raise RuntimeError(f"bad response {s} {mo}")
    q=p.with_suffix(".tmp");q.write_bytes(b);q.replace(p);return s,mo.strftime("%Y-%m"),"downloaded",len(b)

def download(root,workers):
    tasks=[(s,m,root) for s in SYMS for m in months()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex: rows=list(ex.map(dl_one,tasks))
    return pd.DataFrame(rows,columns=["symbol","month","status","bytes"])

def read_zip(p):
    with zipfile.ZipFile(p) as z:
        name=next(n for n in z.namelist() if not n.endswith("/")); d=pd.read_csv(z.open(name),header=None,names=COLS,low_memory=False)
    d.ts=pd.to_numeric(d.ts,errors="coerce");d=d.dropna(subset=["ts"]); med=float(d.ts.median()); unit="us" if med>1e14 else "ms"
    d["time"]=pd.to_datetime(d.ts.astype("int64"),unit=unit,utc=True)
    for c in ["open","high","low","close","quote","taker_quote"]:d[c]=pd.to_numeric(d[c],errors="coerce")
    return d[["time","open","high","low","close","quote","taker_quote"]].dropna()

def rsi(c,n):
    x=c.diff();g=x.clip(lower=0).ewm(alpha=1/n,adjust=False,min_periods=n).mean();l=(-x.clip(upper=0)).ewm(alpha=1/n,adjust=False,min_periods=n).mean()
    out=100-100/(1+g/l.replace(0,np.nan));return out.where(l!=0,100).where(g!=0,0)

def features(d):
    c=d.close;h=d.high;l=d.low;o=d.open;pc=c.shift();tr=pd.concat([h-l,(h-pc).abs(),(l-pc).abs()],axis=1).max(axis=1)
    d["atr"]=tr.ewm(alpha=1/14,adjust=False,min_periods=14).mean();d["ap"]=d.atr/c
    for n in (2,3,5):d[f"r{n}"]=rsi(c,n)
    for n in (20,30,50):
        d[f"m{n}"]=c.rolling(n).mean();d[f"s{n}"]=c.rolling(n).std(ddof=0);d[f"z{n}"]=(c-d[f"m{n}"])/d[f"s{n}"]
    for n in (50,200):d[f"e{n}"]=c.ewm(span=n,adjust=False,min_periods=n).mean()
    up=h.diff();dn=-l.diff();pdm=pd.Series(np.where((up>dn)&(up>0),up,0),index=d.index);mdm=pd.Series(np.where((dn>up)&(dn>0),dn,0),index=d.index)
    aw=tr.ewm(alpha=1/14,adjust=False,min_periods=14).mean();pdi=100*pdm.ewm(alpha=1/14,adjust=False,min_periods=14).mean()/aw;mdi=100*mdm.ewm(alpha=1/14,adjust=False,min_periods=14).mean()/aw
    d["adx"]=(100*(pdi-mdi).abs()/(pdi+mdi)).ewm(alpha=1/14,adjust=False,min_periods=14).mean()
    rg=(h-l).replace(0,np.nan);d["lw"]=(np.minimum(o,c)-l)/rg;d["uw"]=(h-np.maximum(o,c))/rg;d["loc"]=(c-l)/rg;d["sgn"]=np.sign(c-o)
    q=np.log1p(d.quote.clip(lower=0));d["vz"]=(q-q.rolling(20).mean())/q.rolling(20).std(ddof=0)
    d["imb"]=2*d.taker_quote/d.quote.replace(0,np.nan)-1
    for n in (3,6,12,24):d[f"mv{n}"]=(c/c.shift(n)-1)/d.ap
    d["slope"]=(d.e50/d.e50.shift(12)-1)/d.ap;d["gap"]=(d.e50/d.e200-1)/d.ap
    return d

def load_symbol(s,root):
    fs=[]
    for p in sorted((root/s).glob(f"{s}-15m-*.zip")):fs.append(read_zip(p))
    if not fs:return None,{"symbol":s,"rows":0}
    d=pd.concat(fs,ignore_index=True);d=d[(d.time>=START)&(d.time<END)].sort_values("time").drop_duplicates("time").reset_index(drop=True)
    gap=d.time.diff().dropna(); man={"symbol":s,"rows":len(d),"start":str(d.time.min()),"end":str(d.time.max()),"gaps":int((gap!=pd.Timedelta(minutes=15)).sum()),"hash":hashlib.sha256(pd.util.hash_pandas_object(d[["time","close"]],index=False).values.tobytes()).hexdigest()}
    return features(d),man

def configs():
    rnd=random.Random(SEED); out=[]
    spaces={
      "wick":list(itertools.product((20,30,50),(1.5,1.8,2,2.2,2.5),(2,3,5),(5,10,15,20,25),(.2,.35,.5,.65),(.5,.6,.7),(-99,0,.5,1),(20,25,30,999),("any","with","range"),("both","long","short"))),
      "shock":list(itertools.product((3,6,12,24),(1.5,2,2.5,3,3.5,4),(.2,.35,.5,.65),(.5,.6,.7),(-99,0,.5,1),(20,25,30,999),("any","with","range"),("both","long","short"))),
      "trend":list(itertools.product((20,30,50),(.8,1,1.2,1.5,1.8,2),(2,3,5),(10,15,20,25,30),("body","wick","prev"),(-99,0,.5),(20,25,30,999),("both","long","short"))) }
    for fam,n in (("wick",70),("shock",60),("trend",60)):
        rnd.shuffle(spaces[fam])
        for i,p in enumerate(spaces[fam][:n]):out.append((f"{fam}{i:03d}",fam,p))
    out += [("base_wick","wick",(20,1.8,3,10,.2,.5,-99,22,"range","both")),("base_shock","shock",(3,2,.35,.6,.5,30,"any","both"))]
    return out

def exits():
    a=[(.5,.75,4),(.5,1,8),(.5,1.5,8),(.75,.75,8),(.75,1,8),(.75,1.5,16),(.75,2,16),(1,1,8),(1,1.5,16),(1,2,16),(1.25,1.5,16),(1.5,2,32)]
    return [(f"x{i:02d}",*x) for i,x in enumerate(a)]

def arrays(d):
    ks=["open","high","low","close","atr","r2","r3","r5","m20","s20","m30","s30","m50","s50","e50","e200","adx","lw","uw","loc","sgn","vz","mv3","mv6","mv12","mv24","slope","gap"]
    a={k:d[k].to_numpy(float) for k in ks};a["time"]=d.time.astype("int64").to_numpy(np.int64);return a

def regime(a,mode,side):
    if mode=="any":return np.ones(len(a["close"]),bool)
    if mode=="with":return ((a["e50"]>a["e200"])&(a["slope"]>-.5)) if side>0 else ((a["e50"]<a["e200"])&(a["slope"]<.5))
    return np.abs(a["gap"])<4

def signal(a,cfg):
    _,fam,p=cfg; direction=p[-1]; out=np.zeros(len(a["close"]),np.int8); sides=([1,-1] if direction=="both" else [1] if direction=="long" else [-1])
    for side in sides:
        if fam=="wick":
            n,z,rn,rt,w,loc,vz,adx,rg,_=p;m=a[f"m{n}"];sd=a[f"s{n}"];r=a[f"r{rn}"];band=m-side*z*sd
            if side>0:b=(a["low"]<band)&(a["close"]>band)&(r<=rt)&(a["lw"]>=w)&(a["loc"]>=loc)
            else:b=(a["high"]>band)&(a["close"]<band)&(r>=100-rt)&(a["uw"]>=w)&(a["loc"]<=1-loc)
            b&=(a["vz"]>=vz)&(a["adx"]<=adx)&regime(a,rg,side)
        elif fam=="shock":
            lb,mv,w,loc,vz,adx,rg,_=p;x=a[f"mv{lb}"]
            if side>0:b=(x<=-mv)&(a["lw"]>=w)&(a["loc"]>=loc)&(a["sgn"]>=0)
            else:b=(x>=mv)&(a["uw"]>=w)&(a["loc"]<=1-loc)&(a["sgn"]<=0)
            b&=(a["vz"]>=vz)&(a["adx"]<=adx)&regime(a,rg,side)
        else:
            n,z,rn,rt,cf,vz,adx,_=p;m=a[f"m{n}"];sd=a[f"s{n}"];r=a[f"r{rn}"]
            if side>0:b=(a["e50"]>a["e200"])&(a["slope"]>0)&(a["low"]<m-z*sd)&(r<=rt)
            else:b=(a["e50"]<a["e200"])&(a["slope"]<0)&(a["high"]>m+z*sd)&(r>=100-rt)
            if cf=="body":b&=a["sgn"]*side>0
            elif cf=="wick":b&=(a["lw"]>=.35) if side>0 else (a["uw"]>=.35)
            else:
                prev=np.roll(a["close"],1);prev[0]=np.nan;b&=(a["close"]>prev) if side>0 else (a["close"]<prev)
            b&=(a["vz"]>=vz)&(a["adx"]<=adx)
        b&=np.isfinite(a["atr"])&(a["atr"]>0); clash=b&(out==-side);out[clash]=0;out[b&~clash]=side
    return out

@njit(cache=True)
def sim(sig,o,h,l,c,atr,tp,sl,hold):
    z=np.empty(np.count_nonzero(sig),dtype=DT);k=0;blocked=-1;n=len(c)
    for s in range(n-1):
        side=int(sig[s])
        if side==0 or s<=blocked:continue
        ei=s+1;e=o[ei];av=atr[s]
        if not np.isfinite(e) or not np.isfinite(av) or e<=0 or av<=0:continue
        st=min(max(sl*av,e*.003),e*.03);td=min(max(tp*av,e*.0025),2.5*av);sp=e-side*st;tg=e+side*td;end=min(ei+hold-1,n-1);xi=end;xp=c[end];why=3
        for j in range(ei,end+1):
            sh=(l[j]<=sp) if side>0 else (h[j]>=sp);th=(h[j]>=tg) if side>0 else (l[j]<=tg)
            if sh:xi=j;xp=sp;why=2;break
            if th:xi=j;xp=tg;why=1;break
        z[k]["si"]=s;z[k]["ei"]=ei;z[k]["xi"]=xi;z[k]["side"]=side;z[k]["entry"]=e;z[k]["exit"]=xp;z[k]["gross"]=side*(xp/e-1);z[k]["stop"]=st/e;z[k]["why"]=why;k+=1;blocked=xi
    return z[:k]

def trade_df(s,a,sig,x):
    xid,tp,sl,hold=x;t=sim(sig,a["open"],a["high"],a["low"],a["close"],a["atr"],tp,sl,hold)
    if not len(t):return pd.DataFrame()
    tt=pd.to_datetime(a["time"],utc=True);why=np.array(["","target","stop","time"],object)
    return pd.DataFrame({"symbol":s,"entry_time":tt[t["ei"]],"exit_time":tt[t["xi"]],"side":t["side"],"entry":t["entry"],"exit":t["exit"],"gross":t["gross"],"stop_pct":t["stop"],"reason":why[t["why"]]})

def cap_portfolio(d):
    if d.empty:return d
    d=d.sort_values(["entry_time","symbol"]).reset_index(drop=True);en=d.entry_time.astype("int64").to_numpy();ex=d.exit_time.astype("int64").to_numpy();heap=[];keep=np.zeros(len(d),bool)
    for i in range(len(d)):
        while heap and heap[0]<en[i]:heapq.heappop(heap)
        if len(heap)<MAX_OPEN:keep[i]=1;heapq.heappush(heap,int(ex[i]))
    return d[keep].reset_index(drop=True)

def met(d,a,b,cost=COST):
    days=max((b-a).total_seconds()/86400,1)
    if d.empty:return dict(n=0,tpd=0,wr=np.nan,pf=0,exp=np.nan,ret=0,dd=0,posm=np.nan,conc=np.nan)
    x=d.copy();x["net"]=x.gross-cost;x["er"]=x.net*np.minimum(CAP,RISK/(x.stop_pct+cost));w=x.net>0;gp=x.loc[w,"net"].sum();gl=-x.loc[~w,"net"].sum();pf=gp/gl if gl>0 else 99
    x=x.sort_values("exit_time");eq=(1+x.er.clip(lower=-.99)).cumprod();dd=-(eq/eq.cummax()-1).min();mon=x.groupby(x.exit_time.dt.tz_localize(None).dt.to_period("M")).er.sum();sp=x.groupby("symbol").er.sum().abs();conc=sp.max()/sp.sum() if sp.sum()>0 else np.nan
    return dict(n=len(x),tpd=len(x)/days,wr=w.mean(),pf=pf,exp=x.net.mean()*1e4,ret=(eq.iloc[-1]-1)*100,dd=dd*100,posm=(mon>0).mean(),conc=conc)

def splits(d,holdout=False):
    bs={"train":(START,V0),"val":(V0,T0),"test":(T0,H0)}
    if holdout:bs["hold"]=(H0,END)
    return {k:met(d[(d.entry_time>=a)&(d.entry_time<b)],a,b) for k,(a,b) in bs.items()}

def flat(cfg,x,ms):
    row={"cid":cfg[0],"family":cfg[1],"params":json.dumps(cfg[2]),"xid":x[0],"tp_atr":x[1],"sl_atr":x[2],"hold_bars":x[3]}
    for s,m in ms.items():
        for k,v in m.items():row[f"{s}_{k}"]=v
    return row

def score(r):
    vals=[r.train_wr,r.val_wr,r.train_exp,r.val_exp,r.train_posm,r.val_posm,r.train_conc,r.val_conc]
    if r.train_n<150 or r.val_n<70 or not all(np.isfinite(v) for v in vals):return -1e9
    pf=min(r.train_pf,r.val_pf);wr=min(r.train_wr,r.val_wr);ex=min(r.train_exp,r.val_exp);freq=min(r.val_tpd,10);sc=3*math.log(max(pf,1e-6))+5*(wr-.5)+.035*ex+.45*math.log1p(freq)+.8*(min(r.train_posm,r.val_posm)-.5)-.8*max(max(r.train_conc,r.val_conc)-.4,0)
    return sc-(3 if pf<1 or ex<=0 else 0)

def resim(cfg,x,data):
    q=[]
    for s,(d,a) in data.items():
        t=trade_df(s,a,signal(a,cfg),x)
        if not t.empty:q.append(t)
    return cap_portfolio(pd.concat(q,ignore_index=True)) if q else pd.DataFrame()

def boot(d,reps=2000):
    if d.empty:return np.nan,(np.nan,np.nan,np.nan)
    x=d.copy();x["net"]=x.gross-COST;x["month"]=x.entry_time.dt.tz_localize(None).dt.to_period("M");blocks=[g.net.to_numpy() for _,g in x.groupby("month")];rng=np.random.default_rng(SEED);means=[]
    for _ in range(reps):means.append(np.concatenate([blocks[i] for i in rng.integers(0,len(blocks),len(blocks))]).mean()*1e4)
    return float(np.mean(np.array(means)>0)),tuple(np.quantile(means,[.05,.5,.95]))

def run(data,out):
    cs=configs();xs=exits();rows=[]
    for ci,cfg in enumerate(cs,1):
        sig={s:signal(a,cfg) for s,(_,a) in data.items()}
        for x in xs:
            q=[]
            for s,(_,a) in data.items():
                t=trade_df(s,a,sig[s],x)
                if not t.empty:q.append(t)
            d=cap_portfolio(pd.concat(q,ignore_index=True)) if q else pd.DataFrame(columns=["entry_time","exit_time","gross","stop_pct","symbol"]);rows.append(flat(cfg,x,splits(d)))
        if ci%20==0:print(f"entries {ci}/{len(cs)}",flush=True)
    allc=pd.DataFrame(rows);allc["tv_score"]=allc.apply(score,axis=1);allc=allc.sort_values("tv_score",ascending=False).reset_index(drop=True);allc.to_csv(out/"all_candidates.csv",index=False)
    s2=allc.head(30).copy();s2["test_pass"]=(s2.test_n>=70)&(s2.test_pf>1.05)&(s2.test_exp>0)&(s2.test_wr>=.55)&(s2.test_tpd>=2);s2["pre_score"]=s2.tv_score+2*np.log(s2.test_pf.clip(1e-6,5))+3*(s2.test_wr.fillna(0)-.5)+.025*s2.test_exp.fillna(-100)+.3*np.log1p(s2.test_tpd.clip(0,10));s2=s2.sort_values(["test_pass","pre_score"],ascending=False).head(5).reset_index(drop=True)
    cmap={c[0]:c for c in cs};xmap={x[0]:x for x in xs};final=[];logs={}
    for i,r in s2.iterrows():
        d=resim(cmap[r.cid],xmap[r.xid],data);logs[i]=d;row=r.to_dict();row["pre_rank"]=i+1;hm=met(d[(d.entry_time>=H0)&(d.entry_time<END)],H0,END)
        for k,v in hm.items():row[f"hold_{k}"]=v
        oo=d[(d.entry_time>=T0)&(d.entry_time<END)];p,q=boot(oo);row["boot_pos"]=p;row["boot_p05"],row["boot_p50"],row["boot_p95"]=q
        for bp in (6,9,12,18):
            m=met(oo,T0,END,bp/1e4)
            for k in ("wr","pf","exp","ret","dd"):row[f"oos_{bp}_{k}"]=m[k]
        final.append(row)
    f=pd.DataFrame(final).sort_values("pre_rank");f["strict"]=(f.test_n>=70)&(f.hold_n>=25)&(f.test_pf>1.05)&(f.hold_pf>1.05)&(f.test_exp>0)&(f.hold_exp>0)&(f.oos_12_pf>=1.15)&(f.oos_12_wr>=.60)&(f.test_tpd>=2)&(f.hold_tpd>=2)&(f.boot_pos>=.90);f.to_csv(out/"finalists.csv",index=False)
    best=f.iloc[0];d=logs[0].copy();d["net_12bps"]=d.gross-COST;d.to_csv(out/"primary_trades.csv",index=False)
    lines=["# Binance USD-M frequent/high-win-rate search","",f"**Primary verdict: {'PASS' if best.strict else 'FAIL'} strict gates.**","","Primary was fixed before Q2 2026 holdout.","",f"Config `{best.cid}` / `{best.xid}`; family `{best.family}`; params `{best.params}`.","","| Segment | Trades | Trades/day | WR | PF | Exp bps | Risk return | DD |","|---|---:|---:|---:|---:|---:|---:|---:|"]
    for z in ("train","val","test","hold"):lines.append(f"| {z} | {best[z+'_n']:.0f} | {best[z+'_tpd']:.2f} | {best[z+'_wr']*100:.1f}% | {best[z+'_pf']:.3f} | {best[z+'_exp']:.2f} | {best[z+'_ret']:.2f}% | {best[z+'_dd']:.2f}% |")
    lines += ["","## Combined test + holdout cost sensitivity","","| Cost | WR | PF | Exp bps | Return | DD |","|---:|---:|---:|---:|---:|---:|"]
    for bp in (6,9,12,18):lines.append(f"| {bp} bps | {best[f'oos_{bp}_wr']*100:.1f}% | {best[f'oos_{bp}_pf']:.3f} | {best[f'oos_{bp}_exp']:.2f} | {best[f'oos_{bp}_ret']:.2f}% | {best[f'oos_{bp}_dd']:.2f}% |")
    lines += ["",f"Monthly-block bootstrap P(mean>0), 12 bps: {best.boot_pos*100:.1f}%.",f"Bootstrap expectancy p05/p50/p95: {best.boot_p05:.2f}/{best.boot_p50:.2f}/{best.boot_p95:.2f} bps.","",f"Strict passes among five pre-holdout finalists: {int(f.strict.sum())}.","","Caveats: funding, order-book queue and partial fills are not modeled; ambiguous bars are stops; one position per symbol and four portfolio positions maximum."]
    (out/"report.md").write_text("\n".join(lines)+"\n");(out/"summary.json").write_text(json.dumps({"primary":best.to_dict(),"strict_count":int(f.strict.sum()),"combinations":len(allc)},default=str,indent=2))

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--out",type=Path,default=Path("research_results"));ap.add_argument("--cache",type=Path,default=Path(".cache/binance_usdm_15m"));ap.add_argument("--workers",type=int,default=8);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=True);a.cache.mkdir(parents=True,exist_ok=True)
    download(a.cache,a.workers).to_csv(a.out/"download_log.csv",index=False);data={};mans=[]
    for s in SYMS:
        d,m=load_symbol(s,a.cache);mans.append(m)
        if d is not None and len(d)>10000:data[s]=(d,arrays(d));print(s,len(d),flush=True)
    pd.DataFrame(mans).to_csv(a.out/"data_manifest.csv",index=False)
    if len(data)<6:raise RuntimeError("insufficient symbol data")
    run(data,a.out);print((a.out/"report.md").read_text(),flush=True)
if __name__=="__main__":main()
