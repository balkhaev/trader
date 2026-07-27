from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from config import SYMBOLS, START, CUT, PRE_JULY_END, JULY_END
from data import download_monthly, download_july, load_klines, load_funding
from strategy import features

BASE_COST = 12.0
STRESS_COST = 20.0

@dataclass(frozen=True)
class Config:
    name: str
    residual: float
    move: float
    cpos: float
    volz: float
    imbalance: float
    regime: str
    hold: int

CONFIGS = [
    Config("CALM_LOOSE_45", 1.0, 1.5, 0.65, 0.5, 0.10, "calm", 3),
    Config("CALM_STRICT_60", 1.5, 2.0, 0.70, 1.0, 0.20, "calm", 4),
    Config("BROAD_UP_LOOSE_45", 1.0, 1.5, 0.65, 0.5, 0.10, "broad_up", 3),
    Config("BROAD_UP_STRICT_60", 1.5, 2.0, 0.70, 1.0, 0.20, "broad_up", 4),
    Config("ANY_LOOSE_45", 1.0, 1.5, 0.65, 0.5, 0.10, "any", 3),
    Config("ANY_STRICT_60", 1.5, 2.0, 0.70, 1.0, 0.20, "any", 4),
]

def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    i=np.searchsorted(events_ns,entry_ns,side="left")
    return i<len(events_ns) and events_ns[i]<=exit_ns

def simulate_mask(symbol,f,mask,strength,hold,start,end,funding):
    ts=f.open_time.astype("int64").to_numpy()
    first=np.searchsorted(ts,start.value); final=np.searchsorted(ts,end.value)
    cand=np.flatnonzero(mask.fillna(False).to_numpy()&(np.arange(len(f))>=first)&(np.arange(len(f))<final))
    o,h,l,a=[f[c].to_numpy(float) for c in ("open","high","low","atr")]
    times=list(f.open_time); ev=funding.astype("int64").to_numpy()
    out=[]; last=-1
    for si in cand:
        if si<=last or si+1>=final or not np.isfinite(a[si]): continue
        ei=si+1; xi=ei+hold
        if xi>=final or times[ei].date()!=times[xi].date() or crosses(ev,int(ts[ei]),int(ts[xi])): continue
        entry=o[ei]; stop=entry-1.5*a[si]; risk=entry-stop; target=entry+2*risk
        ep=o[xi]; ex=xi; reason="time"; mae=0.; mfe=0.
        for bi in range(ei,xi):
            mae=min(mae,(l[bi]/entry-1)*1e4); mfe=max(mfe,(h[bi]/entry-1)*1e4)
            if o[bi]<=stop: ep,ex,reason=o[bi],bi,"stop_gap"; break
            if l[bi]<=stop: ep,ex,reason=stop,bi,"stop"; break
            if h[bi]>=target: ep,ex,reason=target,bi,"target"; break
        gross=(ep/entry-1)*1e4
        out.append({"symbol":symbol,"signal_time":times[si],"entry_time":times[ei],"exit_time":times[ex],"gross_bps":gross,"net_bps":gross-BASE_COST,"strength":float(strength.iloc[si]),"reason":reason,"mae_bps":mae,"mfe_bps":mfe})
        last=ex
    return out

def portfolio_select(data,min_event=3,topn=3,max_positions=10):
    if data.empty:return data.copy()
    df=data.copy(); df["event_size"]=df.groupby("entry_time").symbol.transform("count"); df=df[df.event_size>=min_event]
    df=df.sort_values(["entry_time","strength"],ascending=[True,False]).groupby("entry_time",group_keys=False).head(topn)
    entries={t:list(g.index) for t,g in df.groupby("entry_time")}; exits={t:list(g.index) for t,g in df.groupby("exit_time")}
    opened=set(); accepted=[]
    for t in sorted(set(entries)|set(exits)):
        for idx in exits.get(t,[]): opened.discard(idx)
        for idx in entries.get(t,[]): 
            if len(opened)>=max_positions: continue
            sym=str(df.loc[idx,"symbol"])
            if any(str(df.loc[j,"symbol"])==sym for j in opened): continue
            opened.add(idx); accepted.append(idx)
    return df.loc[accepted].sort_values("entry_time")

def metrics(df,cost=BASE_COST):
    if df.empty:return {"trades":0,"avg_bps":np.nan,"pf":np.nan,"win_rate":np.nan,"total_bps":0.}
    x=df.gross_bps.to_numpy(float)-cost; g=x[x>0]; z=-x[x<0]
    return {"trades":len(x),"avg_bps":float(x.mean()),"pf":float(g.sum()/z.sum()) if z.sum() else float("inf"),"win_rate":float((x>0).mean()),"total_bps":float(x.sum()),"best_bps":float(x.max()),"worst_bps":float(x.min())}

def bootstrap(df,n=30000):
    if df.empty:return {"lo":np.nan,"hi":np.nan,"p_positive":np.nan}
    days=pd.to_datetime(df.entry_time,utc=True).dt.floor("D"); groups=[g.net_bps.to_numpy(float) for _,g in df.groupby(days)]
    rng=np.random.default_rng(2301); vals=np.empty(n)
    for i in range(n): vals[i]=np.concatenate([groups[j] for j in rng.integers(0,len(groups),len(groups))]).mean()
    return {"lo":float(np.quantile(vals,.025)),"hi":float(np.quantile(vals,.975)),"p_positive":float(np.mean(vals>0))}

def config_mask(f,cfg):
    base=(f.contig4&(f.move3>=cfg.move)&(f.residual_move3>=cfg.residual)&(f.volz>=cfg.volz)&(f.cpos>=cfg.cpos)&(f.imb1>=cfg.imbalance)&(f.uwick<=0.4)&(f.market_count>=40))
    if cfg.regime=="calm": base &= f.market_median_move3 < 0.5
    elif cfg.regime=="broad_up": base &= f.market_median_move3 >= 0.5
    strength=f.residual_move3.clip(lower=0)+f.volz.clip(lower=0)/3+f.imb1.clip(lower=0)+f.cpos
    return base,strength

def run_config(cfg,frames,funding,start,end):
    trades=[]
    for symbol,f in frames.items():
        mask,strength=config_mask(f,cfg)
        trades+=simulate_mask(symbol,f,mask,strength,cfg.hold,start,end,funding[symbol])
    return portfolio_select(pd.DataFrame(trades))

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--output",required=True); parser.add_argument("--cache",required=True); parser.add_argument("--workers",type=int,default=24); args=parser.parse_args()
    output=Path(args.output); cache=Path(args.cache); output.mkdir(parents=True,exist_ok=True); cache.mkdir(parents=True,exist_ok=True)
    manifest=download_monthly(SYMBOLS,cache,args.workers)+download_july(SYMBOLS,cache,args.workers); pd.DataFrame(manifest).to_csv(output/"SOURCE_MANIFEST.csv",index=False)
    frames={}; funding={}; slim=[]
    for symbol in SYMBOLS:
        raw=load_klines(symbol,manifest,include_july=True); funding[symbol]=load_funding(symbol,manifest,include_july=True)
        if raw.empty: continue
        f=features(raw); frames[symbol]=f; slim.append(f[["open_time","move3"]].assign(symbol=symbol))
    panel=pd.concat(slim,ignore_index=True); context=panel.groupby("open_time").move3.agg(market_median_move3="median",market_count="count").reset_index()
    for symbol,f in frames.items():
        f=f.merge(context,on="open_time",how="left"); f["residual_move3"]=f.move3-f.market_median_move3; frames[symbol]=f
    stores={}; grid=[]
    for cfg in CONFIGS:
        stores[cfg.name]={}
        for label,bounds in {"2025H2":(START,CUT),"2026H1":(CUT,PRE_JULY_END)}.items():
            t=run_config(cfg,frames,funding,*bounds); stores[cfg.name][label]=t; grid.append({"config":cfg.name,"period":label,**asdict(cfg),**metrics(t)})
    pd.DataFrame(grid).to_csv(output/"CONFIG_RESULTS_PRE_JULY.csv",index=False)
    candidates=[]
    for cfg in CONFIGS:
        a=metrics(stores[cfg.name]["2025H2"]); b=metrics(stores[cfg.name]["2026H1"])
        eligible=a["trades"]>=50 and b["trades"]>=50 and a["avg_bps"]>0 and b["avg_bps"]>0 and a["pf"]>1.05 and b["pf"]>1.05
        score=min(a["avg_bps"],b["avg_bps"])*math.sqrt(min(a["trades"],b["trades"])/100)*min(a["pf"],b["pf"],3) if eligible else -1e9
        candidates.append({"config":cfg.name,"eligible":eligible,"score":score,"avg_2025H2":a["avg_bps"],"pf_2025H2":a["pf"],"trades_2025H2":a["trades"],"avg_2026H1":b["avg_bps"],"pf_2026H1":b["pf"],"trades_2026H1":b["trades"]})
    selection=pd.DataFrame(candidates).sort_values("score",ascending=False); selection.to_csv(output/"SELECTION_BEFORE_JULY.csv",index=False)
    chosen=next(c for c in CONFIGS if c.name==str(selection.iloc[0].config)); july=run_config(chosen,frames,funding,PRE_JULY_END,JULY_END); july.to_csv(output/"JULY_TRADES.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"chosen":asdict(chosen),"pre_july":selection.to_dict(orient="records"),"july_base12":metrics(july),"july_stress20":metrics(july,STRESS_COST),"july_bootstrap":bootstrap(july)}
    (output/"SUMMARY.json").write_text(json.dumps(summary,indent=2)); (output/"REPORT_RU.md").write_text(f"# Round 23 — cross-sectional relative momentum\n\n{selection.to_markdown(index=False,floatfmt='.2f')}\n\n```json\n{json.dumps(summary,indent=2)}\n```\n"); print(json.dumps(summary,indent=2))
if __name__=="__main__": main()
