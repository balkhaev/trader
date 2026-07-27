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
    wick: float
    volz: float
    regime: str
    hold: int

CONFIGS = [
    Config("IDIO_LOOSE_45", 1.0, 1.5, 0.4, 0.5, "idio", 3),
    Config("IDIO_STRICT_60", 1.5, 2.0, 0.5, 1.0, "idio", 4),
    Config("BROAD_LOOSE_45", 1.0, 1.5, 0.4, 0.5, "broad", 3),
    Config("BROAD_STRICT_60", 1.5, 2.0, 0.5, 1.0, "broad", 4),
    Config("ANY_LOOSE_45", 1.0, 1.5, 0.4, 0.5, "any", 3),
    Config("ANY_STRICT_60", 1.5, 2.0, 0.5, 1.0, "any", 4),
]

def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    i = np.searchsorted(events_ns, entry_ns, side="left")
    return i < len(events_ns) and events_ns[i] <= exit_ns

def simulate_mask(
    symbol: str,
    f: pd.DataFrame,
    mask: pd.Series,
    strength: pd.Series,
    hold: int,
    start: pd.Timestamp,
    end: pd.Timestamp,
    funding: pd.DatetimeIndex,
) -> list[dict[str, object]]:
    ts = f.open_time.astype("int64").to_numpy()
    first = np.searchsorted(ts, start.value)
    final = np.searchsorted(ts, end.value)
    candidates = np.flatnonzero(
        mask.fillna(False).to_numpy()
        & (np.arange(len(f)) >= first)
        & (np.arange(len(f)) < final)
    )
    o, h, l, a = [f[c].to_numpy(float) for c in ("open","high","low","atr")]
    times = list(f.open_time)
    ev = funding.astype("int64").to_numpy()
    out: list[dict[str, object]] = []
    last_exit = -1
    for si in candidates:
        if si <= last_exit or si+1 >= final or not np.isfinite(a[si]):
            continue
        ei = si+1
        scheduled = ei+hold
        if scheduled >= final:
            continue
        if times[ei].date() != times[scheduled].date():
            continue
        if crosses(ev, int(ts[ei]), int(ts[scheduled])):
            continue
        entry = o[ei]
        stop = entry - 1.5*a[si]
        risk = entry-stop
        target = entry + 2.0*risk
        exit_price = o[scheduled]
        exit_index = scheduled
        reason = "time"
        mae = 0.0
        mfe = 0.0
        for bi in range(ei, scheduled):
            mae = min(mae, (l[bi]/entry-1)*1e4)
            mfe = max(mfe, (h[bi]/entry-1)*1e4)
            if o[bi] <= stop:
                exit_price, exit_index, reason = o[bi], bi, "stop_gap"
                break
            if l[bi] <= stop:
                exit_price, exit_index, reason = stop, bi, "stop"
                break
            if h[bi] >= target:
                exit_price, exit_index, reason = target, bi, "target"
                break
        gross = (exit_price/entry-1)*1e4
        out.append({
            "symbol":symbol,
            "signal_time":times[si],
            "entry_time":times[ei],
            "exit_time":times[exit_index],
            "gross_bps":gross,
            "net_bps":gross-BASE_COST,
            "strength":float(strength.iloc[si]),
            "reason":reason,
            "mae_bps":mae,
            "mfe_bps":mfe,
        })
        last_exit = exit_index
    return out

def portfolio_select(data: pd.DataFrame, min_event: int = 3, topn: int = 3, max_positions: int = 10) -> pd.DataFrame:
    if data.empty:
        return data.copy()
    df = data.copy()
    df["event_size"] = df.groupby("entry_time").symbol.transform("count")
    df = df[df.event_size >= min_event]
    df = (
        df.sort_values(["entry_time","strength"], ascending=[True,False])
        .groupby("entry_time", group_keys=False)
        .head(topn)
    )
    entries = {t:list(g.index) for t,g in df.groupby("entry_time")}
    exits = {t:list(g.index) for t,g in df.groupby("exit_time")}
    open_idx: set[int] = set()
    accepted: list[int] = []
    for t in sorted(set(entries)|set(exits)):
        for idx in exits.get(t,[]):
            open_idx.discard(idx)
        for idx in entries.get(t,[]):
            if len(open_idx) >= max_positions:
                continue
            symbol = str(df.loc[idx,"symbol"])
            if any(str(df.loc[j,"symbol"]) == symbol for j in open_idx):
                continue
            open_idx.add(idx)
            accepted.append(idx)
    return df.loc[accepted].sort_values("entry_time")

def metrics(df: pd.DataFrame, cost: float = BASE_COST) -> dict[str,float|int]:
    if df.empty:
        return {"trades":0,"avg_bps":np.nan,"pf":np.nan,"win_rate":np.nan,"total_bps":0.0}
    x = df.gross_bps.to_numpy(float)-cost
    g=x[x>0]; z=-x[x<0]
    return {
        "trades":len(x),
        "avg_bps":float(x.mean()),
        "pf":float(g.sum()/z.sum()) if z.sum() else float("inf"),
        "win_rate":float((x>0).mean()),
        "total_bps":float(x.sum()),
        "best_bps":float(x.max()),
        "worst_bps":float(x.min()),
    }

def bootstrap(df: pd.DataFrame, n: int = 30000) -> dict[str,float]:
    if df.empty:
        return {"lo":np.nan,"hi":np.nan,"p_positive":np.nan}
    days = pd.to_datetime(df.entry_time,utc=True).dt.floor("D")
    groups=[g.net_bps.to_numpy(float) for _,g in df.groupby(days)]
    rng=np.random.default_rng(2201)
    vals=np.empty(n)
    for i in range(n):
        vals[i]=np.concatenate([groups[j] for j in rng.integers(0,len(groups),len(groups))]).mean()
    return {"lo":float(np.quantile(vals,.025)),"hi":float(np.quantile(vals,.975)),"p_positive":float(np.mean(vals>0))}

def config_mask(f: pd.DataFrame, cfg: Config) -> tuple[pd.Series,pd.Series]:
    base = (
        f.contig4
        & (f.move3 <= -cfg.move)
        & (f.residual_move3 <= -cfg.residual)
        & (f.volz >= cfg.volz)
        & (f.lwick >= cfg.wick)
        & (f.cpos >= 0.55)
        & (f.imb1 >= -0.1)
        & (f.market_count >= 40)
    )
    if cfg.regime == "idio":
        base &= f.market_median_move3 > -0.5
    elif cfg.regime == "broad":
        base &= f.market_median_move3 <= -0.5
    strength = (-f.residual_move3).clip(lower=0) + f.lwick + f.volz.clip(lower=0)/3 + f.imb1.clip(lower=0)
    return base, strength

def run_config(
    cfg: Config,
    frames: dict[str,pd.DataFrame],
    funding: dict[str,pd.DatetimeIndex],
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> pd.DataFrame:
    trades=[]
    for symbol,f in frames.items():
        mask,strength=config_mask(f,cfg)
        trades += simulate_mask(symbol,f,mask,strength,cfg.hold,start,end,funding[symbol])
    return portfolio_select(pd.DataFrame(trades))

def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",required=True)
    parser.add_argument("--cache",required=True)
    parser.add_argument("--workers",type=int,default=24)
    args=parser.parse_args()
    output=Path(args.output); cache=Path(args.cache)
    output.mkdir(parents=True,exist_ok=True); cache.mkdir(parents=True,exist_ok=True)

    manifest=download_monthly(SYMBOLS,cache,args.workers)
    manifest += download_july(SYMBOLS,cache,args.workers)
    pd.DataFrame(manifest).to_csv(output/"SOURCE_MANIFEST.csv",index=False)

    frames={}
    funding={}
    slim=[]
    for symbol in SYMBOLS:
        raw=load_klines(symbol,manifest,include_july=True)
        funding[symbol]=load_funding(symbol,manifest,include_july=True)
        if raw.empty:
            continue
        f=features(raw)
        frames[symbol]=f
        slim.append(f[["open_time","move3"]].assign(symbol=symbol))
    panel=pd.concat(slim,ignore_index=True)
    context=panel.groupby("open_time").move3.agg(market_median_move3="median",market_count="count").reset_index()
    for symbol,f in frames.items():
        f=f.merge(context,on="open_time",how="left")
        f["residual_move3"]=f.move3-f.market_median_move3
        frames[symbol]=f

    grid=[]
    stores={}
    for cfg in CONFIGS:
        stores[cfg.name]={}
        for label,bounds in {"2025H2":(START,CUT),"2026H1":(CUT,PRE_JULY_END)}.items():
            t=run_config(cfg,frames,funding,*bounds)
            stores[cfg.name][label]=t
            m=metrics(t)
            grid.append({"config":cfg.name,"period":label,**asdict(cfg),**m})
    grid_df=pd.DataFrame(grid); grid_df.to_csv(output/"CONFIG_RESULTS_PRE_JULY.csv",index=False)

    candidates=[]
    for cfg in CONFIGS:
        a=metrics(stores[cfg.name]["2025H2"]); b=metrics(stores[cfg.name]["2026H1"])
        eligible=a["trades"]>=50 and b["trades"]>=50 and a["avg_bps"]>0 and b["avg_bps"]>0 and a["pf"]>1.05 and b["pf"]>1.05
        score=min(a["avg_bps"],b["avg_bps"])*math.sqrt(min(a["trades"],b["trades"])/100)*min(a["pf"],b["pf"],3) if eligible else -1e9
        candidates.append({"config":cfg.name,"eligible":eligible,"score":score,"avg_2025H2":a["avg_bps"],"pf_2025H2":a["pf"],"trades_2025H2":a["trades"],"avg_2026H1":b["avg_bps"],"pf_2026H1":b["pf"],"trades_2026H1":b["trades"]})
    selection=pd.DataFrame(candidates).sort_values("score",ascending=False)
    selection.to_csv(output/"SELECTION_BEFORE_JULY.csv",index=False)
    chosen_name=str(selection.iloc[0].config)
    chosen=next(c for c in CONFIGS if c.name==chosen_name)
    july=run_config(chosen,frames,funding,PRE_JULY_END,JULY_END)
    july.to_csv(output/"JULY_TRADES.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"chosen":asdict(chosen),"pre_july":selection.to_dict(orient="records"),"july_base12":metrics(july),"july_stress20":metrics(july,STRESS_COST),"july_bootstrap":bootstrap(july)}
    (output/"SUMMARY.json").write_text(json.dumps(summary,indent=2))
    (output/"REPORT_RU.md").write_text(f"# Round 22 — cross-sectional residual reversal\n\n## Selection before July\n\n{selection.to_markdown(index=False,floatfmt='.2f')}\n\n## July\n\n```json\n{json.dumps(summary,indent=2)}\n```\n")
    print(json.dumps(summary,indent=2))

if __name__=="__main__":
    main()
