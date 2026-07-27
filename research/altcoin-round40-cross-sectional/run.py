#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from config import CUT, JULY_END, PRE_JULY_END, START, SYMBOLS
from data import download_july, download_monthly, load_funding, load_klines

COST_BPS = 20.0

@dataclass(frozen=True)
class Config:
    name: str
    mode: str
    lookback: int
    z_threshold: float
    k: int
    hold: int
    market_threshold: float

CONFIGS=[]
for lookback in (16,32):
    for z in (1.0,1.5):
        for k in (3,5):
            for hold in (8,16):
                CONFIGS.append(Config(f"NEUT_LB{lookback}_Z{int(z*10)}_K{k}_H{hold}","neutral",lookback,z,k,hold,0.0))
                for mt in (0.25,0.50):
                    CONFIGS.append(Config(f"DIR_LB{lookback}_Z{int(z*10)}_K{k}_H{hold}_M{int(mt*100)}","directional",lookback,z,k,hold,mt))


def atr(frame: pd.DataFrame,n: int=14) -> pd.Series:
    pc=frame.close.shift(); tr=pd.concat([frame.high-frame.low,(frame.high-pc).abs(),(frame.low-pc).abs()],axis=1).max(axis=1)
    return tr.ewm(alpha=1/n,adjust=False,min_periods=n).mean()


def build_panel(frames: dict[str,pd.DataFrame]) -> pd.DataFrame:
    pieces=[]
    for symbol,raw in frames.items():
        x=raw.copy().sort_values("open_time")
        for c in ("open","high","low","close","volume","quote_volume"):
            x[c]=pd.to_numeric(x[c],errors="coerce")
        x["atr"]=atr(x); logret=np.log(x.close).diff(); vol=logret.rolling(96,min_periods=48).std()
        for lb in (16,32):
            x[f"score{lb}"]=np.log(x.close).diff(lb)/(vol*np.sqrt(lb)+1e-12)
        x["symbol"]=symbol
        pieces.append(x[["open_time","open","high","low","close","atr","score16","score32","symbol"]])
    panel=pd.concat(pieces,ignore_index=True).dropna().sort_values(["open_time","symbol"])
    return panel.reset_index(drop=True)


def context(panel: pd.DataFrame,lb: int) -> pd.DataFrame:
    score=f"score{lb}"
    c=panel.groupby("open_time")[score].agg(market_median="median",market_std="std",market_count="count").reset_index()
    breadth=panel.assign(pos=panel[score]>0).groupby("open_time").pos.mean().rename("breadth").reset_index()
    c=c.merge(breadth,on="open_time",how="left")
    x=panel.merge(c,on="open_time",how="left")
    x["z"]=(x[score]-x.market_median)/x.market_std.replace(0,np.nan)
    return x


def events(panel: pd.DataFrame,cfg: Config) -> pd.DataFrame:
    x=context(panel,cfg.lookback)
    x=x[(x.open_time.dt.minute==0)&(x.market_count>=40)&x.z.notna()].copy()
    rows=[]
    for ts,g in x.groupby("open_time",sort=True):
        if cfg.mode=="neutral":
            longs=g[g.z>=cfg.z_threshold].nlargest(cfg.k,"z").copy(); shorts=g[g.z<=-cfg.z_threshold].nsmallest(cfg.k,"z").copy()
            if len(longs)<cfg.k or len(shorts)<cfg.k: continue
            longs["side"]=1; shorts["side"]=-1; chosen=pd.concat([longs,shorts],ignore_index=True)
        else:
            med=float(g.market_median.iloc[0]); breadth=float(g.breadth.iloc[0])
            if med>=cfg.market_threshold and breadth>=0.58:
                chosen=g[g.z>=cfg.z_threshold].nlargest(cfg.k,"z").copy(); chosen["side"]=1
            elif med<=-cfg.market_threshold and breadth<=0.42:
                chosen=g[g.z<=-cfg.z_threshold].nsmallest(cfg.k,"z").copy(); chosen["side"]=-1
            else: continue
            if len(chosen)<cfg.k: continue
        chosen["event_time"]=ts; chosen["strength"]=chosen.z.abs()+chosen[f"score{cfg.lookback}"].abs()/2
        rows.append(chosen)
    return pd.concat(rows,ignore_index=True) if rows else pd.DataFrame()


def crosses(funding_ns: np.ndarray,entry_ns: int,exit_ns: int) -> bool:
    if not len(funding_ns): return False
    i=np.searchsorted(funding_ns,entry_ns,side="left")
    return i<len(funding_ns) and funding_ns[i]<=exit_ns


def simulate(ev: pd.DataFrame,frames: dict[str,pd.DataFrame],funding: dict[str,pd.DatetimeIndex],cfg: Config,start: pd.Timestamp,end: pd.Timestamp) -> pd.DataFrame:
    if ev.empty: return pd.DataFrame()
    idx={s:{t:i for i,t in enumerate(f.open_time)} for s,f in frames.items()}; arr={s:{c:f[c].to_numpy(float) for c in ("open","high","low","atr")} for s,f in frames.items()}; times={s:list(f.open_time) for s,f in frames.items()}; fns={s:v.astype("int64").to_numpy() for s,v in funding.items()}; last={s:-1 for s in frames}; rows=[]
    subset=ev[(ev.event_time>=start)&(ev.event_time<end)].sort_values(["event_time","strength"],ascending=[True,False])
    for _,row in subset.iterrows():
        s=str(row.symbol); sig=idx[s].get(row.event_time)
        if sig is None or sig<=last[s]: continue
        entry_i=sig+1; exit_i=entry_i+cfg.hold
        if exit_i>=len(times[s]): continue
        entry_t=times[s][entry_i]; scheduled=times[s][exit_i]
        if not(start<=entry_t<end) or scheduled>=end or entry_t.date()!=scheduled.date(): continue
        if crosses(fns[s],int(pd.Timestamp(entry_t).value),int(pd.Timestamp(scheduled).value)): continue
        side=int(row.side); entry=arr[s]["open"][entry_i]; a=arr[s]["atr"][sig]
        if not np.isfinite(a): continue
        stop=entry-side*2.0*a; exit_price=arr[s]["open"][exit_i]; reason="time"; actual_exit=exit_i; mae=0.; mfe=0.
        for j in range(entry_i,exit_i):
            ex=(side*(arr[s]["high"][j]/entry-1)*1e4,side*(arr[s]["low"][j]/entry-1)*1e4); mae=min(mae,*ex); mfe=max(mfe,*ex)
            if side==1 and arr[s]["open"][j]<=stop: exit_price,actual_exit,reason=arr[s]["open"][j],j,"stop_gap"; break
            if side==-1 and arr[s]["open"][j]>=stop: exit_price,actual_exit,reason=arr[s]["open"][j],j,"stop_gap"; break
            if side==1 and arr[s]["low"][j]<=stop: exit_price,actual_exit,reason=stop,j,"stop"; break
            if side==-1 and arr[s]["high"][j]>=stop: exit_price,actual_exit,reason=stop,j,"stop"; break
        gross=side*(exit_price/entry-1)*1e4
        rows.append({"config":cfg.name,"mode":cfg.mode,"event_time":row.event_time,"symbol":s,"side":side,"entry_time":entry_t,"exit_time":times[s][actual_exit],"gross_bps":gross,"net20_bps":gross-COST_BPS,"stop_distance_bps":abs(stop/entry-1)*1e4+COST_BPS,"z":float(row.z),"strength":float(row.strength),"reason":reason,"mae_bps":mae,"mfe_bps":mfe})
        last[s]=actual_exit
    return pd.DataFrame(rows)


def leg_metrics(df: pd.DataFrame) -> dict:
    if df.empty: return {"legs":0,"leg_avg_bps":np.nan,"leg_pf":np.nan,"leg_win_rate":np.nan}
    v=df.net20_bps.to_numpy(float); loss=-v[v<0].sum()
    return {"legs":int(len(v)),"leg_avg_bps":float(v.mean()),"leg_pf":float(v[v>0].sum()/loss) if loss else float("inf"),"leg_win_rate":float(np.mean(v>0))}


def event_returns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty: return pd.DataFrame(columns=["event_time","event_bps","legs"])
    return df.groupby("event_time").agg(event_bps=("net20_bps","mean"),legs=("net20_bps","size")).reset_index()


def event_metrics(df: pd.DataFrame) -> dict:
    e=event_returns(df)
    if e.empty: return {"events":0,"event_avg_bps":np.nan,"event_pf":np.nan,"event_win_rate":np.nan}
    v=e.event_bps.to_numpy(float); loss=-v[v<0].sum()
    return {"events":int(len(v)),"event_avg_bps":float(v.mean()),"event_pf":float(v[v>0].sum()/loss) if loss else float("inf"),"event_win_rate":float(np.mean(v>0))}


def portfolio(df: pd.DataFrame,fraction_per_leg: float=0.04,capital: float=10000.) -> dict:
    e=event_returns(df)
    if e.empty: return {}
    equity=capital; peak=capital; maxdd=0.
    for _,row in e.sort_values("event_time").iterrows():
        gross=min(row.legs*fraction_per_leg,0.60); equity+=equity*gross*row.event_bps/1e4; peak=max(peak,equity); maxdd=max(maxdd,1-equity/peak)
    days=(JULY_END-PRE_JULY_END).days
    return {"fraction_per_leg":fraction_per_leg,"end_usd":equity,"return_pct":(equity/capital-1)*100,"mechanical_annualized_pct":((equity/capital)**(365/days)-1)*100,"closed_dd_pct":maxdd*100,"events":len(e),"legs":int(e.legs.sum())}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",required=True,type=Path); ap.add_argument("--cache",required=True,type=Path); ap.add_argument("--workers",type=int,default=24); args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    manifest=download_monthly(SYMBOLS,args.cache,args.workers)+download_july(SYMBOLS,args.cache,args.workers); pd.DataFrame(manifest).to_csv(args.output/"SOURCE_MANIFEST.csv",index=False)
    frames={}; funding={}; coverage=[]
    for s in SYMBOLS:
        raw=load_klines(s,manifest,include_july=True); f=load_funding(s,manifest,include_july=True); coverage.append({"symbol":s,"rows":len(raw),"first":None if raw.empty else raw.open_time.iloc[0],"last":None if raw.empty else raw.open_time.iloc[-1],"funding_events":len(f)})
        if len(raw): frames[s]=raw; funding[s]=f
    pd.DataFrame(coverage).to_csv(args.output/"COVERAGE.csv",index=False); panel=build_panel(frames)
    stores={}; grid=[]
    for cfg in CONFIGS:
        ev=events(panel,cfg); stores[cfg.name]={}
        for label,bounds in {"2025H2":(START,CUT),"2026H1":(CUT,PRE_JULY_END)}.items():
            t=simulate(ev,frames,funding,cfg,*bounds); stores[cfg.name][label]=t; grid.append({"config":cfg.name,"period":label,**asdict(cfg),**leg_metrics(t),**event_metrics(t)})
    pd.DataFrame(grid).to_csv(args.output/"CONFIG_RESULTS_PRE_JULY.csv",index=False)
    selection=[]
    for cfg in CONFIGS:
        a={**leg_metrics(stores[cfg.name]["2025H2"]),**event_metrics(stores[cfg.name]["2025H2"])}; b={**leg_metrics(stores[cfg.name]["2026H1"]),**event_metrics(stores[cfg.name]["2026H1"])}; eligible=(a["events"]>=50 and b["events"]>=50 and a["event_avg_bps"]>0 and b["event_avg_bps"]>0 and a["event_pf"]>=1.10 and b["event_pf"]>=1.10); score=min(a["event_avg_bps"],b["event_avg_bps"])*math.sqrt(min(a["events"],b["events"])/50)*min(a["event_pf"],b["event_pf"],3) if eligible else -1e9; selection.append({"config":cfg.name,"eligible":eligible,"score":score,**{f"2025H2_{k}":v for k,v in a.items()},**{f"2026H1_{k}":v for k,v in b.items()}})
    selection=pd.DataFrame(selection).sort_values("score",ascending=False); selection.to_csv(args.output/"SELECTION_BEFORE_JULY.csv",index=False); chosen_name=str(selection.iloc[0].config); chosen=next(c for c in CONFIGS if c.name==chosen_name); july=simulate(events(panel,chosen),frames,funding,chosen,PRE_JULY_END,JULY_END); july.to_csv(args.output/"JULY_TRADES.csv",index=False); event_returns(july).to_csv(args.output/"JULY_EVENTS.csv",index=False)
    accounts=[portfolio(july,f) for f in (.02,.04,.06,.08)]; pd.DataFrame(accounts).to_csv(args.output/"JULY_ACCOUNT_SCENARIOS.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"configs":len(CONFIGS),"eligible_configs":int(selection.eligible.sum()),"chosen":asdict(chosen),"july_legs":leg_metrics(july),"july_events":event_metrics(july),"accounts":accounts,"selection":selection.to_dict(orient="records")}; (args.output/"SUMMARY.json").write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8"); (args.output/"REPORT_RU.md").write_text("# Round 40 — medium cross-sectional momentum\n\n```json\n"+json.dumps(summary,indent=2,default=str)+"\n```\n",encoding="utf-8"); print(json.dumps(summary,indent=2,default=str))
if __name__=="__main__": main()
