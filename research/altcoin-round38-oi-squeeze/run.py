#!/usr/bin/env python3
from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

SOURCE_DIR = Path(__file__).resolve().parents[1] / "altcoin-round26-positioning"
sys.path.insert(0, str(SOURCE_DIR))

from config import SYMBOLS, WARMUP_START, START, CUT, PRE_JULY_END, JULY_END
from data import download_all, load_funding, load_klines, load_metrics
from strategy import build_features

BASE_COST = 12.0
STRESS_COST = 20.0

@dataclass(frozen=True)
class Config:
    name: str
    side: int
    channel: int
    compression: float
    oi_z: float
    taker: float
    volume_z: float
    hold: int
    stop_atr: float
    target_r: float | None
    top_confirm: bool


def configs() -> list[Config]:
    output=[]
    for side,channel,compression,oi_z,hold,top in itertools.product(
        (1,-1),(16,32),(0.65,0.80),(0.75,1.50),(8,16),(False,True)
    ):
        taker=0.05 if oi_z==0.75 else 0.10
        volume_z=0.25 if compression==0.80 else 0.75
        stop=1.5 if hold==8 else 1.75
        target=4.0 if hold==8 and oi_z==1.50 else None
        name=(f"SQ_{'L' if side==1 else 'S'}_N{channel}_C{int(compression*100)}_"
              f"OI{int(oi_z*100)}_H{hold}_{'TOP' if top else 'RAW'}")
        output.append(Config(name,side,channel,compression,oi_z,taker,volume_z,hold,stop,target,top))
    return output

CONFIGS=configs()


def enrich(frame: pd.DataFrame) -> pd.DataFrame:
    x=frame.copy()
    logret=np.log(x.close).diff()
    rv=logret.rolling(8,min_periods=8).std()
    reference=rv.rolling(288*7,min_periods=288).median().shift(1)
    x["compression_ratio"]=rv/reference.replace(0,np.nan)
    logq=np.log1p(pd.to_numeric(x.quote_volume,errors="coerce").clip(lower=0))
    mean=logq.rolling(96,min_periods=48).mean(); std=logq.rolling(96,min_periods=48).std().replace(0,np.nan)
    x["volume_z"]=(logq-mean)/std
    for n in (16,32):
        x[f"hi{n}"]=x.high.rolling(n,min_periods=n).max().shift(1)
        x[f"lo{n}"]=x.low.rolling(n,min_periods=n).min().shift(1)
        x[f"width_atr{n}"]=(x[f"hi{n}"]-x[f"lo{n}"])/x.atr.replace(0,np.nan)
    return x


def signal(frame: pd.DataFrame,cfg: Config) -> tuple[pd.Series,pd.Series]:
    hi=frame[f"hi{cfg.channel}"]; lo=frame[f"lo{cfg.channel}"]
    compressed=frame.compression_ratio.shift(1)<=cfg.compression
    if cfg.side==1:
        mask=(frame.contig4 & compressed & (frame.close>hi) &
              (frame.oi_z3>=cfg.oi_z) & (frame.taker3>=cfg.taker) &
              (frame.volume_z>=cfg.volume_z) & (frame.cpos>=0.70))
        if cfg.top_confirm:
            mask &= (frame.top_position_z>=0) & (frame.spread_z>=-0.25)
        strength=((frame.close-hi)/frame.atr.replace(0,np.nan)+frame.oi_z3+
                  frame.taker3.clip(lower=0)+frame.volume_z.clip(lower=0)/3)
    else:
        mask=(frame.contig4 & compressed & (frame.close<lo) &
              (frame.oi_z3>=cfg.oi_z) & (frame.taker3<=-cfg.taker) &
              (frame.volume_z>=cfg.volume_z) & (frame.cpos<=0.30))
        if cfg.top_confirm:
            mask &= (frame.top_position_z<=0) & (frame.spread_z<=0.25)
        strength=((lo-frame.close)/frame.atr.replace(0,np.nan)+frame.oi_z3+
                  (-frame.taker3).clip(lower=0)+frame.volume_z.clip(lower=0)/3)
    return mask.fillna(False),strength.replace([np.inf,-np.inf],np.nan).fillna(0)


def crosses(events_ns: np.ndarray,entry_ns: int,exit_ns: int) -> bool:
    if not len(events_ns): return False
    i=np.searchsorted(events_ns,entry_ns,side="left")
    return i<len(events_ns) and events_ns[i]<=exit_ns


def simulate(symbol: str,frame: pd.DataFrame,funding: pd.DatetimeIndex,cfg: Config,start: pd.Timestamp,end: pd.Timestamp) -> pd.DataFrame:
    mask,strength=signal(frame,cfg)
    ts_ns=frame.open_time.astype("int64").to_numpy(); first=np.searchsorted(ts_ns,start.value); final=np.searchsorted(ts_ns,end.value)
    candidates=np.flatnonzero(mask.to_numpy()&(np.arange(len(frame))>=first)&(np.arange(len(frame))<final))
    opens=frame.open.to_numpy(float); highs=frame.high.to_numpy(float); lows=frame.low.to_numpy(float); atrs=frame.atr.to_numpy(float); times=list(frame.open_time); events=funding.astype("int64").to_numpy()
    rows=[]; last_exit=-1
    for sig in candidates:
        if sig<=last_exit or sig+1>=final: continue
        entry_i=sig+1; scheduled=entry_i+cfg.hold
        if scheduled>=final or times[entry_i].date()!=times[scheduled].date(): continue
        if crosses(events,int(ts_ns[entry_i]),int(ts_ns[scheduled])): continue
        side=cfg.side; entry=opens[entry_i]; a=atrs[sig]
        if not np.isfinite(a): continue
        stop=entry-side*cfg.stop_atr*a; risk=abs(entry-stop); target=None if cfg.target_r is None else entry+side*cfg.target_r*risk
        exit_price=opens[scheduled]; exit_i=scheduled; reason="time"; mae=0.; mfe=0.
        for j in range(entry_i,scheduled):
            ex=(side*(highs[j]/entry-1)*1e4,side*(lows[j]/entry-1)*1e4); mae=min(mae,*ex); mfe=max(mfe,*ex)
            if side==1 and opens[j]<=stop: exit_price,exit_i,reason=opens[j],j,"stop_gap"; break
            if side==-1 and opens[j]>=stop: exit_price,exit_i,reason=opens[j],j,"stop_gap"; break
            if side==1 and lows[j]<=stop: exit_price,exit_i,reason=stop,j,"stop"; break
            if side==-1 and highs[j]>=stop: exit_price,exit_i,reason=stop,j,"stop"; break
            if target is not None and side==1 and highs[j]>=target: exit_price,exit_i,reason=target,j,"target"; break
            if target is not None and side==-1 and lows[j]<=target: exit_price,exit_i,reason=target,j,"target"; break
        gross=side*(exit_price/entry-1)*1e4
        rows.append({"config":cfg.name,"symbol":symbol,"side":side,"signal_time":times[sig],"entry_time":times[entry_i],"exit_time":times[exit_i],"gross_bps":gross,"net12_bps":gross-BASE_COST,"net20_bps":gross-STRESS_COST,"stop_distance_bps":risk/entry*1e4+STRESS_COST,"strength":float(strength.iloc[sig]),"reason":reason,"mae_bps":mae,"mfe_bps":mfe})
        last_exit=exit_i
    return pd.DataFrame(rows)


def metrics(df: pd.DataFrame,col: str="net20_bps") -> dict:
    if df.empty: return {"trades":0,"avg_bps":np.nan,"pf":np.nan,"win_rate":np.nan,"symbols":0,"breadth":0.}
    x=df[col].to_numpy(float); loss=-x[x<0].sum(); by=df.groupby("symbol")[col].agg(["count","mean"]); eligible=by[by["count"]>=5]
    return {"trades":int(len(x)),"avg_bps":float(x.mean()),"pf":float(x[x>0].sum()/loss) if loss else float("inf"),"win_rate":float(np.mean(x>0)),"symbols":int(df.symbol.nunique()),"breadth":float((eligible["mean"]>0).mean()) if len(eligible) else 0.}


def account(df: pd.DataFrame,risk_pct: float,capital: float=10000.,max_positions: int=4,gross_cap: float=6.):
    data=df.sort_values(["entry_time","strength"],ascending=[True,False]).reset_index(drop=True); equity=capital; open_pos={}; accepted=[]; curve=[]
    for ts in sorted(set(data.entry_time)|set(data.exit_time)):
        for idx,pos in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_time==ts and row.entry_time<ts: pnl=pos*row.net20_bps/1e4; equity+=pnl; accepted.append({**row.to_dict(),"notional":pos,"pnl_usd":pnl,"equity_after":equity}); del open_pos[idx]
        for idx in data.index[data.entry_time==ts]:
            row=data.iloc[idx]
            if len(open_pos)>=max_positions or any(data.iloc[j].symbol==row.symbol for j in open_pos): continue
            notional=min(equity*(risk_pct/100)/(row.stop_distance_bps/1e4),equity*2); remaining=max(0.,equity*gross_cap-sum(open_pos.values())); notional=min(notional,remaining)
            if notional>0: open_pos[idx]=notional
        for idx,pos in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_time==ts and row.entry_time==ts: pnl=pos*row.net20_bps/1e4; equity+=pnl; accepted.append({**row.to_dict(),"notional":pos,"pnl_usd":pnl,"equity_after":equity}); del open_pos[idx]
        curve.append({"time":ts,"equity":equity})
    c=pd.DataFrame(curve); dd=c.equity/c.equity.cummax()-1
    return {"risk_pct":risk_pct,"end_usd":equity,"return_pct":(equity/capital-1)*100,"closed_dd_pct":-float(dd.min())*100,"trades":len(accepted)}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",required=True,type=Path); ap.add_argument("--cache",required=True,type=Path); ap.add_argument("--workers",type=int,default=32); args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    manifest=download_all(SYMBOLS,args.cache,args.workers); pd.DataFrame(manifest).to_csv(args.output/"SOURCE_MANIFEST.csv",index=False)
    frames={}; funding={}; coverage=[]
    for symbol in SYMBOLS:
        k=load_klines(symbol,manifest); m=load_metrics(symbol,manifest); f=load_funding(symbol,manifest); coverage.append({"symbol":symbol,"kline_rows":len(k),"metric_rows":len(m),"funding_events":len(f)})
        if len(k) and len(m): frames[symbol]=enrich(build_features(k,m)); funding[symbol]=f
    pd.DataFrame(coverage).to_csv(args.output/"COVERAGE.csv",index=False)
    stores={}; grid=[]
    for cfg in CONFIGS:
        stores[cfg.name]={}
        for label,bounds in {"2025H2":(START,CUT),"2026H1":(CUT,PRE_JULY_END)}.items():
            parts=[simulate(s,frame,funding[s],cfg,*bounds) for s,frame in frames.items()]; t=pd.concat(parts,ignore_index=True) if parts else pd.DataFrame(); stores[cfg.name][label]=t; grid.append({"config":cfg.name,"period":label,**asdict(cfg),**metrics(t)})
    pd.DataFrame(grid).to_csv(args.output/"CONFIG_RESULTS_PRE_JULY.csv",index=False)
    selection=[]
    for cfg in CONFIGS:
        a=metrics(stores[cfg.name]["2025H2"]); b=metrics(stores[cfg.name]["2026H1"]); eligible=(a["trades"]>=60 and b["trades"]>=60 and a["avg_bps"]>0 and b["avg_bps"]>0 and a["pf"]>=1.10 and b["pf"]>=1.10 and a["breadth"]>=0.40 and b["breadth"]>=0.40); score=min(a["avg_bps"],b["avg_bps"])*math.sqrt(min(a["trades"],b["trades"])/60)*min(a["pf"],b["pf"],3) if eligible else -1e9; selection.append({"config":cfg.name,"eligible":eligible,"score":score,**{f"2025H2_{k}":v for k,v in a.items()},**{f"2026H1_{k}":v for k,v in b.items()}})
    selection=pd.DataFrame(selection).sort_values("score",ascending=False); selection.to_csv(args.output/"SELECTION_BEFORE_JULY.csv",index=False)
    chosen_name=str(selection.iloc[0].config); chosen=next(c for c in CONFIGS if c.name==chosen_name); parts=[simulate(s,frame,funding[s],chosen,PRE_JULY_END,JULY_END) for s,frame in frames.items()]; july=pd.concat(parts,ignore_index=True) if parts else pd.DataFrame(); july.to_csv(args.output/"JULY_TRADES.csv",index=False)
    accounts=pd.DataFrame([account(july,r) for r in (1,2,4,6)]); accounts.to_csv(args.output/"JULY_ACCOUNT_SCENARIOS.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"configs":len(CONFIGS),"eligible_configs":int(selection.eligible.sum()),"chosen":asdict(chosen),"july":metrics(july),"accounts":accounts.to_dict(orient="records"),"selection":selection.to_dict(orient="records")}; (args.output/"SUMMARY.json").write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8"); (args.output/"REPORT_RU.md").write_text("# Round 38 — OI squeeze breakout\n\n```json\n"+json.dumps(summary,indent=2,default=str)+"\n```\n",encoding="utf-8"); print(json.dumps(summary,indent=2,default=str))
if __name__=="__main__": main()
