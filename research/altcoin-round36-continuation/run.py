#!/usr/bin/env python3
from __future__ import annotations

import argparse
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

from config import BASE_COST_BPS, STRESS_COST_BPS, SYMBOLS, WARMUP_START, START, CUT, PRE_JULY_END, JULY_END
from data import download_all, load_funding, load_klines, load_metrics
from strategy import atr, build_features

BASE_COST = 12.0
STRESS_COST = 20.0

@dataclass(frozen=True)
class Config:
    name: str
    mechanism: str
    side: int
    move: float
    oi_z: float
    taker: float
    close_pos: float
    volume_z: float
    hold: int
    stop_atr: float
    target_r: float | None

CONFIGS = [
    Config("BUILD_L_M10_O10_H8", "build", 1, 1.0, 1.0, 0.05, 0.65, 0.0, 8, 1.5, None),
    Config("BUILD_L_M15_O15_H16", "build", 1, 1.5, 1.5, 0.10, 0.70, 0.5, 16, 1.75, None),
    Config("BUILD_L_M20_O15_H32", "build", 1, 2.0, 1.5, 0.10, 0.70, 0.75, 32, 2.0, None),
    Config("BUILD_L_M15_O15_H16_T4", "build", 1, 1.5, 1.5, 0.10, 0.70, 0.5, 16, 1.75, 4.0),
    Config("BUILD_S_M10_O10_H8", "build", -1, 1.0, 1.0, 0.05, 0.35, 0.0, 8, 1.5, None),
    Config("BUILD_S_M15_O15_H16", "build", -1, 1.5, 1.5, 0.10, 0.30, 0.5, 16, 1.75, None),
    Config("BUILD_S_M20_O15_H32", "build", -1, 2.0, 1.5, 0.10, 0.30, 0.75, 32, 2.0, None),
    Config("BUILD_S_M15_O15_H16_T4", "build", -1, 1.5, 1.5, 0.10, 0.30, 0.5, 16, 1.75, 4.0),
    Config("FLUSH_L_M15_O10_H8", "flush_cont", 1, 1.5, -1.0, 0.05, 0.65, 0.5, 8, 1.5, None),
    Config("FLUSH_L_M20_O15_H16", "flush_cont", 1, 2.0, -1.5, 0.10, 0.70, 0.75, 16, 1.75, None),
    Config("FLUSH_L_M20_O15_H32", "flush_cont", 1, 2.0, -1.5, 0.10, 0.70, 0.75, 32, 2.0, None),
    Config("FLUSH_S_M15_O10_H8", "flush_cont", -1, 1.5, -1.0, 0.05, 0.35, 0.5, 8, 1.5, None),
    Config("FLUSH_S_M20_O15_H16", "flush_cont", -1, 2.0, -1.5, 0.10, 0.30, 0.75, 16, 1.75, None),
    Config("FLUSH_S_M20_O15_H32", "flush_cont", -1, 2.0, -1.5, 0.10, 0.30, 0.75, 32, 2.0, None),
    Config("TOP_L_M10_O10_H16", "top_confirm", 1, 1.0, 1.0, 0.05, 0.65, 0.5, 16, 1.75, None),
    Config("TOP_S_M10_O10_H16", "top_confirm", -1, 1.0, 1.0, 0.05, 0.35, 0.5, 16, 1.75, None),
]

def add_features(frame: pd.DataFrame) -> pd.DataFrame:
    x=frame.copy(); logq=np.log1p(pd.to_numeric(x.quote_volume,errors="coerce").clip(lower=0))
    mean=logq.rolling(96,min_periods=48).mean(); std=logq.rolling(96,min_periods=48).std().replace(0,np.nan)
    x["volume_z"]=(logq-mean)/std
    return x

def signal(frame: pd.DataFrame,cfg: Config):
    side=cfg.side; move=frame.move3
    if cfg.mechanism=="build":
        if side==1:
            mask=frame.contig4&(move>=cfg.move)&(frame.oi_z3>=cfg.oi_z)&(frame.taker3>=cfg.taker)&(frame.cpos>=cfg.close_pos)&(frame.volume_z>=cfg.volume_z)&(frame.retail_z<=2.0)
            strength=move+frame.oi_z3+frame.taker3.clip(lower=0)+frame.volume_z.clip(lower=0)/3
        else:
            mask=frame.contig4&(move<=-cfg.move)&(frame.oi_z3>=cfg.oi_z)&(frame.taker3<=-cfg.taker)&(frame.cpos<=cfg.close_pos)&(frame.volume_z>=cfg.volume_z)&(frame.retail_z>=-2.0)
            strength=-move+frame.oi_z3+(-frame.taker3).clip(lower=0)+frame.volume_z.clip(lower=0)/3
    elif cfg.mechanism=="flush_cont":
        if side==1:
            mask=frame.contig4&(move>=cfg.move)&(frame.oi_z3<=cfg.oi_z)&(frame.taker3>=cfg.taker)&(frame.cpos>=cfg.close_pos)&(frame.volume_z>=cfg.volume_z)
            strength=move-frame.oi_z3+frame.taker3.clip(lower=0)+frame.volume_z.clip(lower=0)/3
        else:
            mask=frame.contig4&(move<=-cfg.move)&(frame.oi_z3<=cfg.oi_z)&(frame.taker3<=-cfg.taker)&(frame.cpos<=cfg.close_pos)&(frame.volume_z>=cfg.volume_z)
            strength=-move-frame.oi_z3+(-frame.taker3).clip(lower=0)+frame.volume_z.clip(lower=0)/3
    elif cfg.mechanism=="top_confirm":
        if side==1:
            mask=frame.contig4&(move>=cfg.move)&(frame.oi_z3>=cfg.oi_z)&(frame.taker3>=cfg.taker)&(frame.cpos>=cfg.close_pos)&(frame.volume_z>=cfg.volume_z)&(frame.top_position_z>=0)&(frame.spread_z>=0)
            strength=move+frame.oi_z3+frame.top_position_z.clip(lower=0)+frame.taker3.clip(lower=0)
        else:
            mask=frame.contig4&(move<=-cfg.move)&(frame.oi_z3>=cfg.oi_z)&(frame.taker3<=-cfg.taker)&(frame.cpos<=cfg.close_pos)&(frame.volume_z>=cfg.volume_z)&(frame.top_position_z<=0)&(frame.spread_z<=0)
            strength=-move+frame.oi_z3+(-frame.top_position_z).clip(lower=0)+(-frame.taker3).clip(lower=0)
    else: raise ValueError(cfg.mechanism)
    return mask.fillna(False),strength.replace([np.inf,-np.inf],np.nan).fillna(0)

def crosses(events,entry,exit_):
    if not len(events): return False
    i=np.searchsorted(events,entry,side="left")
    return i<len(events) and events[i]<=exit_

def simulate(symbol,frame,funding,cfg,start,end):
    mask,strength=signal(frame,cfg); ts_ns=frame.open_time.astype("int64").to_numpy(); first=np.searchsorted(ts_ns,start.value); final=np.searchsorted(ts_ns,end.value)
    candidates=np.flatnonzero(mask.to_numpy()&(np.arange(len(frame))>=first)&(np.arange(len(frame))<final))
    opens=frame.open.to_numpy(float); highs=frame.high.to_numpy(float); lows=frame.low.to_numpy(float); atrs=frame.atr.to_numpy(float); times=list(frame.open_time); funding_ns=funding.astype("int64").to_numpy()
    output=[]; last_exit=-1
    for signal_index in candidates:
        if signal_index<=last_exit or signal_index+1>=final: continue
        entry_index=signal_index+1; exit_scheduled=entry_index+cfg.hold
        if exit_scheduled>=final or times[entry_index].date()!=times[exit_scheduled].date(): continue
        if crosses(funding_ns,int(ts_ns[entry_index]),int(ts_ns[exit_scheduled])): continue
        entry=opens[entry_index]; side=cfg.side; a=atrs[signal_index]
        if not np.isfinite(a): continue
        stop=entry-side*cfg.stop_atr*a; risk=abs(entry-stop); target=None if cfg.target_r is None else entry+side*cfg.target_r*risk
        exit_price=opens[exit_scheduled]; exit_index=exit_scheduled; reason="time"; mae=0.; mfe=0.
        for j in range(entry_index,exit_scheduled):
            ex=[side*(highs[j]/entry-1)*1e4,side*(lows[j]/entry-1)*1e4]; mae=min(mae,*ex); mfe=max(mfe,*ex)
            if side==1 and opens[j]<=stop: exit_price,exit_index,reason=opens[j],j,"stop_gap"; break
            if side==-1 and opens[j]>=stop: exit_price,exit_index,reason=opens[j],j,"stop_gap"; break
            if side==1 and lows[j]<=stop: exit_price,exit_index,reason=stop,j,"stop"; break
            if side==-1 and highs[j]>=stop: exit_price,exit_index,reason=stop,j,"stop"; break
            if target is not None and side==1 and highs[j]>=target: exit_price,exit_index,reason=target,j,"target"; break
            if target is not None and side==-1 and lows[j]<=target: exit_price,exit_index,reason=target,j,"target"; break
        gross=side*(exit_price/entry-1)*1e4
        output.append({"config":cfg.name,"mechanism":cfg.mechanism,"symbol":symbol,"side":side,"signal_time":times[signal_index],"entry_time":times[entry_index],"exit_time":times[exit_index],"gross_bps":gross,"net12_bps":gross-BASE_COST,"net20_bps":gross-STRESS_COST,"stop_distance_bps":risk/entry*1e4+STRESS_COST,"strength":float(strength.iloc[signal_index]),"reason":reason,"mae_bps":mae,"mfe_bps":mfe})
        last_exit=exit_index
    return pd.DataFrame(output)

def metrics(df,col="net20_bps"):
    if df.empty: return {"trades":0,"avg_bps":np.nan,"pf":np.nan,"win_rate":np.nan,"symbols":0,"breadth":np.nan}
    x=df[col].to_numpy(float); loss=-x[x<0].sum(); by=df.groupby("symbol")[col].agg(["count","mean"])
    return {"trades":int(len(x)),"avg_bps":float(x.mean()),"pf":float(x[x>0].sum()/loss) if loss else float("inf"),"win_rate":float(np.mean(x>0)),"symbols":int(df.symbol.nunique()),"breadth":float((by.loc[by["count"]>=5,"mean"]>0).mean()) if (by["count"]>=5).any() else 0.}

def account(df,risk_pct,capital=10000.,max_positions=4,gross_cap=6.0):
    data=df.sort_values(["entry_time","strength"],ascending=[True,False]).reset_index(drop=True); equity=capital; open_pos={}; accepted=[]; curve=[]
    for ts in sorted(set(data.entry_time)|set(data.exit_time)):
        for idx,pos in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_time==ts and row.entry_time<ts: pnl=pos*row.net20_bps/1e4; equity+=pnl; accepted.append({**row.to_dict(),"notional":pos,"pnl_usd":pnl,"equity_after":equity}); del open_pos[idx]
        for idx in data.index[data.entry_time==ts]:
            row=data.iloc[idx]
            if len(open_pos)>=max_positions or any(data.iloc[j].symbol==row.symbol for j in open_pos): continue
            notional=min(equity*(risk_pct/100)/(row.stop_distance_bps/1e4),equity*2); remain=max(0,equity*gross_cap-sum(open_pos.values())); notional=min(notional,remain)
            if notional>0: open_pos[idx]=notional
        for idx,pos in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_time==ts and row.entry_time==ts: pnl=pos*row.net20_bps/1e4; equity+=pnl; accepted.append({**row.to_dict(),"notional":pos,"pnl_usd":pnl,"equity_after":equity}); del open_pos[idx]
        curve.append({"time":ts,"equity":equity})
    c=pd.DataFrame(curve); dd=c.equity/c.equity.cummax()-1
    return {"risk_pct":risk_pct,"end_usd":equity,"return_pct":(equity/capital-1)*100,"closed_dd_pct":-float(dd.min())*100,"trades":len(accepted)}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",required=True,type=Path); ap.add_argument("--cache",required=True,type=Path); ap.add_argument("--workers",type=int,default=32)
    args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    manifest=download_all(SYMBOLS,args.cache,args.workers); pd.DataFrame(manifest).to_csv(args.output/"SOURCE_MANIFEST.csv",index=False)
    frames={}; funding={}; coverage=[]
    for symbol in SYMBOLS:
        k=load_klines(symbol,manifest); m=load_metrics(symbol,manifest); f=load_funding(symbol,manifest); coverage.append({"symbol":symbol,"kline_rows":len(k),"metric_rows":len(m),"funding_events":len(f)})
        if len(k) and len(m): frames[symbol]=add_features(build_features(k,m)); funding[symbol]=f
    pd.DataFrame(coverage).to_csv(args.output/"COVERAGE.csv",index=False)
    stores={}; rows=[]; periods={"2025H2":(START,CUT),"2026H1":(CUT,PRE_JULY_END)}
    for cfg in CONFIGS:
        stores[cfg.name]={}
        for label,bounds in periods.items():
            parts=[simulate(s,frame,funding[s],cfg,*bounds) for s,frame in frames.items()]; t=pd.concat(parts,ignore_index=True) if parts else pd.DataFrame(); stores[cfg.name][label]=t; rows.append({"config":cfg.name,"period":label,**asdict(cfg),**metrics(t)})
    grid=pd.DataFrame(rows); grid.to_csv(args.output/"CONFIG_RESULTS_PRE_JULY.csv",index=False)
    selection=[]
    for cfg in CONFIGS:
        a=metrics(stores[cfg.name]["2025H2"]); b=metrics(stores[cfg.name]["2026H1"]); eligible=(a["trades"]>=100 and b["trades"]>=100 and a["avg_bps"]>0 and b["avg_bps"]>0 and a["pf"]>=1.10 and b["pf"]>=1.10 and a["breadth"]>=0.40 and b["breadth"]>=0.40); score=min(a["avg_bps"],b["avg_bps"])*math.sqrt(min(a["trades"],b["trades"])/100)*min(a["pf"],b["pf"],3) if eligible else -1e9; selection.append({"config":cfg.name,"eligible":eligible,"score":score,**{f"2025H2_{k}":v for k,v in a.items()},**{f"2026H1_{k}":v for k,v in b.items()}})
    selection=pd.DataFrame(selection).sort_values("score",ascending=False); selection.to_csv(args.output/"SELECTION_BEFORE_JULY.csv",index=False)
    chosen_name=str(selection.iloc[0].config); chosen=next(c for c in CONFIGS if c.name==chosen_name); july_parts=[simulate(s,frame,funding[s],chosen,PRE_JULY_END,JULY_END) for s,frame in frames.items()]; july=pd.concat(july_parts,ignore_index=True) if july_parts else pd.DataFrame(); july.to_csv(args.output/"JULY_TRADES.csv",index=False)
    accounts=pd.DataFrame([account(july,r) for r in (1,2,4,6)]); accounts.to_csv(args.output/"JULY_ACCOUNT_SCENARIOS.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"eligible_configs":int(selection.eligible.sum()),"chosen":asdict(chosen),"july":metrics(july),"accounts":accounts.to_dict(orient="records"),"selection":selection.to_dict(orient="records")}; (args.output/"SUMMARY.json").write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8"); (args.output/"REPORT_RU.md").write_text("# Round 36 — OI continuation\n\n```json\n"+json.dumps(summary,indent=2,default=str)+"\n```\n",encoding="utf-8"); print(json.dumps(summary,indent=2,default=str))
if __name__=="__main__": main()
