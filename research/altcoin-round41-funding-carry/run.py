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

from config import SYMBOLS, START, CUT, PRE_JULY_END, JULY_END
from data import download_all, load_funding, load_series

COST_BPS = 20.0

@dataclass(frozen=True)
class Config:
    name: str
    mode: str
    k: int
    threshold_bps: float
    persistence: bool

CONFIGS=[]
for mode in ("neutral","short_positive","long_negative"):
    for k in (2,3,5):
        for threshold in (2.0,5.0,10.0):
            for persistence in (False,True):
                CONFIGS.append(Config(f"{mode.upper()}_K{k}_T{int(threshold)}_{'PERSIST' if persistence else 'RAW'}",mode,k,threshold,persistence))


def build_event_panel(prices: dict[str,pd.DataFrame],funding: dict[str,pd.DataFrame]) -> pd.DataFrame:
    grid=pd.DataFrame({"event_time":pd.date_range(START,JULY_END,freq="8h",tz="UTC")})
    pieces=[]
    for symbol in SYMBOLS:
        if symbol not in prices or symbol not in funding: continue
        f=funding[symbol][["funding_time","funding_rate"]].sort_values("funding_time").copy()
        g=pd.merge_asof(grid.sort_values("event_time"),f,left_on="event_time",right_on="funding_time",direction="backward",tolerance=pd.Timedelta(minutes=15))
        g["symbol"]=symbol; g["previous_rate"]=g.funding_rate.shift(1); pieces.append(g)
    return pd.concat(pieces,ignore_index=True).dropna(subset=["funding_rate"])


def price_at(frame: pd.DataFrame,ts: pd.Timestamp) -> float | None:
    row=frame[frame.open_time==ts]
    return None if row.empty else float(row.open.iloc[0])


def actual_funding(frame: pd.DataFrame,entry: pd.Timestamp,exit_: pd.Timestamp,side: int) -> float:
    events=frame[(frame.funding_time>entry)&(frame.funding_time<=exit_)]
    return float((-side*events.funding_rate*1e4).sum())


def signal_legs(group: pd.DataFrame,cfg: Config) -> pd.DataFrame:
    g=group.copy(); g["rate_bps"]=g.funding_rate*1e4; g["previous_bps"]=g.previous_rate*1e4
    if cfg.persistence:
        g=g[np.sign(g.rate_bps)==np.sign(g.previous_bps)]
    if cfg.mode=="neutral":
        shorts=g[g.rate_bps>=cfg.threshold_bps].nlargest(cfg.k,"rate_bps").copy(); longs=g[g.rate_bps<=-cfg.threshold_bps].nsmallest(cfg.k,"rate_bps").copy()
        if len(shorts)<cfg.k or len(longs)<cfg.k: return pd.DataFrame()
        shorts["side"]=-1; longs["side"]=1; return pd.concat([shorts,longs],ignore_index=True)
    if cfg.mode=="short_positive":
        legs=g[g.rate_bps>=cfg.threshold_bps].nlargest(cfg.k,"rate_bps").copy()
        if len(legs)<cfg.k: return pd.DataFrame()
        legs["side"]=-1; return legs
    legs=g[g.rate_bps<=-cfg.threshold_bps].nsmallest(cfg.k,"rate_bps").copy()
    if len(legs)<cfg.k: return pd.DataFrame()
    legs["side"]=1; return legs


def simulate(panel: pd.DataFrame,prices: dict[str,pd.DataFrame],funding: dict[str,pd.DataFrame],cfg: Config,start: pd.Timestamp,end: pd.Timestamp) -> pd.DataFrame:
    rows=[]
    for event_time,group in panel[(panel.event_time>=start)&(panel.event_time<end)].groupby("event_time",sort=True):
        entry=event_time+pd.Timedelta(minutes=15); exit_=event_time+pd.Timedelta(hours=8,minutes=15)
        if exit_>=end or entry.date()!=exit_.date(): continue
        legs=signal_legs(group,cfg)
        if legs.empty: continue
        event_rows=[]
        for _,leg in legs.iterrows():
            symbol=str(leg.symbol); side=int(leg.side); ep=price_at(prices[symbol],entry); xp=price_at(prices[symbol],exit_)
            if ep is None or xp is None: continue
            price_bps=side*(xp/ep-1)*1e4; funding_bps=actual_funding(funding[symbol],entry,exit_,side); net=price_bps+funding_bps-COST_BPS
            event_rows.append({"config":cfg.name,"mode":cfg.mode,"event_time":event_time,"symbol":symbol,"side":side,"entry_time":entry,"exit_time":exit_,"signal_funding_bps":float(leg.rate_bps),"next_funding_bps":funding_bps,"price_bps":price_bps,"net20_bps":net})
        if len(event_rows)==len(legs): rows.extend(event_rows)
    return pd.DataFrame(rows)


def event_returns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty: return pd.DataFrame(columns=["event_time","event_bps","legs"])
    return df.groupby("event_time").agg(event_bps=("net20_bps","mean"),legs=("net20_bps","size"),funding_bps=("next_funding_bps","mean"),price_bps=("price_bps","mean")).reset_index()


def metrics(df: pd.DataFrame) -> dict:
    e=event_returns(df)
    if e.empty: return {"events":0,"legs":0,"event_avg_bps":np.nan,"event_pf":np.nan,"event_win_rate":np.nan,"funding_avg_bps":np.nan,"price_avg_bps":np.nan}
    v=e.event_bps.to_numpy(float); loss=-v[v<0].sum()
    return {"events":int(len(e)),"legs":int(e.legs.sum()),"event_avg_bps":float(v.mean()),"event_pf":float(v[v>0].sum()/loss) if loss else float("inf"),"event_win_rate":float(np.mean(v>0)),"funding_avg_bps":float(e.funding_bps.mean()),"price_avg_bps":float(e.price_bps.mean())}


def portfolio(df: pd.DataFrame,fraction_per_leg: float=0.05,capital: float=10000.) -> dict:
    e=event_returns(df); equity=capital; peak=capital; dd=0.
    for _,row in e.sort_values("event_time").iterrows():
        gross=min(row.legs*fraction_per_leg,0.60); equity+=equity*gross*row.event_bps/1e4; peak=max(peak,equity); dd=max(dd,1-equity/peak)
    days=(JULY_END-PRE_JULY_END).days
    return {"fraction_per_leg":fraction_per_leg,"end_usd":equity,"return_pct":(equity/capital-1)*100,"mechanical_annualized_pct":((equity/capital)**(365/days)-1)*100,"closed_dd_pct":dd*100,"events":len(e),"legs":int(e.legs.sum()) if len(e) else 0}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",required=True,type=Path); ap.add_argument("--cache",required=True,type=Path); ap.add_argument("--workers",type=int,default=24); args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    manifest=download_all(SYMBOLS,args.cache,args.workers); pd.DataFrame(manifest).to_csv(args.output/"SOURCE_MANIFEST.csv",index=False)
    prices={}; funding={}; coverage=[]
    for s in SYMBOLS:
        p=load_series(s,manifest,premium=False); f=load_funding(s,manifest,args.output); coverage.append({"symbol":s,"price_rows":len(p),"funding_events":len(f),"first":None if p.empty else p.open_time.iloc[0],"last":None if p.empty else p.open_time.iloc[-1]})
        if len(p) and len(f): prices[s]=p; funding[s]=f
    pd.DataFrame(coverage).to_csv(args.output/"COVERAGE.csv",index=False); panel=build_event_panel(prices,funding)
    stores={}; grid=[]
    for cfg in CONFIGS:
        stores[cfg.name]={}
        for label,bounds in {"2025H2":(START,CUT),"2026H1":(CUT,PRE_JULY_END)}.items():
            t=simulate(panel,prices,funding,cfg,*bounds); stores[cfg.name][label]=t; grid.append({"config":cfg.name,"period":label,**asdict(cfg),**metrics(t)})
    pd.DataFrame(grid).to_csv(args.output/"CONFIG_RESULTS_PRE_JULY.csv",index=False)
    selection=[]
    for cfg in CONFIGS:
        a=metrics(stores[cfg.name]["2025H2"]); b=metrics(stores[cfg.name]["2026H1"]); eligible=(a["events"]>=80 and b["events"]>=80 and a["event_avg_bps"]>0 and b["event_avg_bps"]>0 and a["event_pf"]>=1.10 and b["event_pf"]>=1.10); score=min(a["event_avg_bps"],b["event_avg_bps"])*math.sqrt(min(a["events"],b["events"])/80)*min(a["event_pf"],b["event_pf"],3) if eligible else -1e9; selection.append({"config":cfg.name,"eligible":eligible,"score":score,**{f"2025H2_{k}":v for k,v in a.items()},**{f"2026H1_{k}":v for k,v in b.items()}})
    selection=pd.DataFrame(selection).sort_values("score",ascending=False); selection.to_csv(args.output/"SELECTION_BEFORE_JULY.csv",index=False); chosen_name=str(selection.iloc[0].config); chosen=next(c for c in CONFIGS if c.name==chosen_name); july=simulate(panel,prices,funding,chosen,PRE_JULY_END,JULY_END); july.to_csv(args.output/"JULY_TRADES.csv",index=False); event_returns(july).to_csv(args.output/"JULY_EVENTS.csv",index=False)
    accounts=[portfolio(july,f) for f in (.025,.05,.075,.10)]; pd.DataFrame(accounts).to_csv(args.output/"JULY_ACCOUNT_SCENARIOS.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"configs":len(CONFIGS),"eligible_configs":int(selection.eligible.sum()),"chosen":asdict(chosen),"july":metrics(july),"accounts":accounts,"selection":selection.to_dict(orient="records")}; (args.output/"SUMMARY.json").write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8"); (args.output/"REPORT_RU.md").write_text("# Round 41 — funding carry persistence\n\n```json\n"+json.dumps(summary,indent=2,default=str)+"\n```\n",encoding="utf-8"); print(json.dumps(summary,indent=2,default=str))
if __name__=="__main__": main()
