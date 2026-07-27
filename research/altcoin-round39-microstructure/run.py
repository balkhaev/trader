#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import io
import itertools
import json
import math
import re
import time
import zipfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "SUIUSDT",
    "1000PEPEUSDT", "ADAUSDT", "LINKUSDT", "AVAXUSDT", "WIFUSDT",
]
WARMUP = pd.Timestamp("2025-06-01", tz="UTC")
START = pd.Timestamp("2025-07-01", tz="UTC")
CUT = pd.Timestamp("2026-01-01", tz="UTC")
PRE_JULY_END = pd.Timestamp("2026-07-01", tz="UTC")
JULY_END = pd.Timestamp("2026-07-27", tz="UTC")
BASE_COST = 10.0
STRESS_COST = 16.0
QUEUE_BPS = 2.0
INTERVAL = "1m"
KLINE_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/klines"
KLINE_DAILY = "https://data.binance.vision/data/futures/um/daily/klines"
FUNDING_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]

@dataclass(frozen=True)
class Config:
    name: str
    family: str
    side: int
    lookback: int
    move_atr: float
    imbalance: float
    wick: float
    volume_z: float
    hold: int
    offset_atr: float
    stop_atr: float
    target_r: float


def configs() -> list[Config]:
    out=[]
    tiers={
        "absorption": [(1.0,0.15,0.35,0.25),(1.5,0.25,0.50,0.75)],
        "impulse": [(1.5,0.15,0.00,0.50),(2.0,0.25,0.00,0.75)],
    }
    for family, values in tiers.items():
        for side,lb,hold,tier in itertools.product((1,-1),(3,5),(10,20),range(2)):
            move,imb,wick,vz=values[tier]
            offset=0.10 if family=="absorption" else 0.15
            stop=1.25 if hold==10 else 1.50
            target=2.0 if family=="absorption" else 2.5
            name=(f"{family[:3].upper()}_{'L' if side==1 else 'S'}_"
                  f"N{lb}_T{tier+1}_H{hold}")
            out.append(Config(name,family,side,lb,move,imb,wick,vz,hold,offset,stop,target))
    return out

CONFIGS=configs()


def _get(url: str, timeout: int=180) -> requests.Response:
    last=None
    for attempt in range(6):
        try:
            r=requests.get(url,timeout=timeout,headers={"User-Agent":"altcoin-microstructure-round39/1"})
            if r.status_code==404:
                return r
            r.raise_for_status(); return r
        except Exception as exc:
            last=exc; time.sleep(1+attempt*2)
    raise RuntimeError(f"{url}: {last}")


def _sha(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1<<20),b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(task: tuple[str,str,str,str,Path]) -> dict:
    symbol,period,kind,url,path=task; path.parent.mkdir(parents=True,exist_ok=True)
    meta={"symbol":symbol,"period":period,"kind":kind,"url":url,"path":str(path)}
    try:
        c=_get(url+".CHECKSUM",60)
        if c.status_code==404: return meta|{"status":"missing"}
        m=re.search(r"\b([0-9a-fA-F]{64})\b",c.text)
        if not m: raise RuntimeError("invalid checksum")
        expected=m.group(1).lower()
        if path.exists() and _sha(path)==expected:
            return meta|{"status":"cached_verified","sha256":expected,"bytes":path.stat().st_size}
        r=_get(url,240)
        if r.status_code==404: return meta|{"status":"missing"}
        actual=hashlib.sha256(r.content).hexdigest()
        if actual!=expected: raise RuntimeError(f"sha {actual} != {expected}")
        tmp=path.with_suffix(path.suffix+".tmp"); tmp.write_bytes(r.content); tmp.replace(path)
        return meta|{"status":"downloaded_verified","sha256":actual,"bytes":len(r.content)}
    except Exception as exc:
        return meta|{"status":"error","error":str(exc)}


def tasks(cache: Path):
    out=[]
    months=pd.period_range("2025-06","2026-06",freq="M")
    for symbol in SYMBOLS:
        for p in months:
            month=p.strftime("%Y-%m")
            name=f"{symbol}-{INTERVAL}-{month}.zip"
            out.append((symbol,month,"kline_monthly",f"{KLINE_MONTHLY}/{symbol}/{INTERVAL}/{name}",cache/"kline_monthly"/symbol/name))
            fname=f"{symbol}-fundingRate-{month}.zip"
            out.append((symbol,month,"funding_monthly",f"{FUNDING_MONTHLY}/{symbol}/{fname}",cache/"funding_monthly"/symbol/fname))
        for day in pd.date_range(PRE_JULY_END,JULY_END-pd.Timedelta(days=1),freq="1D"):
            date=day.strftime("%Y-%m-%d"); name=f"{symbol}-{INTERVAL}-{date}.zip"
            out.append((symbol,date,"kline_daily",f"{KLINE_DAILY}/{symbol}/{INTERVAL}/{name}",cache/"kline_daily"/symbol/name))
    return out


def download_all(cache: Path, workers: int) -> list[dict]:
    work=tasks(cache); rows=[]
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for i,item in enumerate(ex.map(fetch,work),1):
            rows.append(item)
            if i%100==0: print(f"archives {i}/{len(work)}",flush=True)
    return rows


def verified(symbol: str,manifest: list[dict],kinds: set[str]) -> list[Path]:
    return sorted(Path(str(x["path"])) for x in manifest if x["symbol"]==symbol and x["kind"] in kinds and x["status"] in {"cached_verified","downloaded_verified"})


def member(path: Path) -> bytes:
    with zipfile.ZipFile(path) as z:
        names=[n for n in z.namelist() if not n.endswith("/")]
        return z.read(names[0]) if names else b""


def parse_kline(path: Path) -> pd.DataFrame:
    raw=member(path)
    if not raw: return pd.DataFrame(columns=COLS)
    first=raw.splitlines()[0].decode("utf-8",errors="replace").lower(); header="open_time" in first or "open time" in first
    df=pd.read_csv(io.BytesIO(raw),header=0 if header else None,low_memory=False)
    if header: df.columns=[str(c).strip().lower().replace(" ","_") for c in df.columns]
    else: df=df.iloc[:,:12]; df.columns=COLS[:df.shape[1]]
    for col in COLS:
        if col not in df: df[col]=np.nan
    ts=pd.to_numeric(df.open_time,errors="coerce"); ts=ts.where(ts<1e14,ts//1000)
    df["open_time"]=pd.to_datetime(ts,unit="ms",utc=True,errors="coerce")
    for c in COLS[1:-1]: df[c]=pd.to_numeric(df[c],errors="coerce")
    return df.dropna(subset=["open_time","open","high","low","close","volume"])[COLS]


def load_klines(symbol: str, manifest: list[dict]) -> pd.DataFrame:
    parts=[parse_kline(p) for p in verified(symbol,manifest,{"kline_monthly","kline_daily"})]
    if not parts: return pd.DataFrame(columns=COLS)
    df=pd.concat(parts,ignore_index=True).sort_values("open_time").drop_duplicates("open_time")
    return df[(df.open_time>=WARMUP)&(df.open_time<JULY_END)].reset_index(drop=True)


def load_funding(symbol: str, manifest: list[dict]) -> pd.DatetimeIndex:
    vals=[]
    for p in verified(symbol,manifest,{"funding_monthly"}):
        raw=member(p); df=pd.read_csv(io.BytesIO(raw),low_memory=False)
        if "calc_time" in df.columns: x=pd.to_numeric(df.calc_time,errors="coerce")
        else: x=pd.to_numeric(pd.read_csv(io.BytesIO(raw),header=None).iloc[:,0],errors="coerce")
        x=x.dropna(); x=x.where(x<1e14,x//1000); vals.extend(x.astype("int64").tolist())
    historical=pd.to_datetime(pd.Series(vals,dtype="int64"),unit="ms",utc=True) if vals else pd.Series([],dtype="datetime64[ns, UTC]")
    july=pd.date_range(PRE_JULY_END,JULY_END,freq="8h",tz="UTC")
    return pd.DatetimeIndex(list(historical)+list(july)).drop_duplicates().sort_values()


def atr(df,n=14):
    pc=df.close.shift(); tr=pd.concat([df.high-df.low,(df.high-pc).abs(),(df.low-pc).abs()],axis=1).max(axis=1)
    return tr.ewm(alpha=1/n,adjust=False,min_periods=n).mean()


def zscore(s,window=1440,minimum=360):
    mean=s.rolling(window,min_periods=minimum).mean(); std=s.rolling(window,min_periods=minimum).std().replace(0,np.nan)
    return (s-mean)/std


def features(df: pd.DataFrame) -> pd.DataFrame:
    x=df.copy(); x["atr"]=atr(x); x["atr_pct"]=x.atr/x.close
    imbalance=(2*x.taker_buy_base/x.volume.replace(0,np.nan)-1).clip(-1,1).fillna(0)
    x["imb1"]=imbalance
    for n in (3,5):
        x[f"move{n}"]=x.close.pct_change(n)/x.atr_pct.replace(0,np.nan)
        x[f"imb{n}"]=imbalance.rolling(n).mean()
        path=np.log(x.close).diff().abs().rolling(n).sum()
        x[f"eff{n}"]=np.log(x.close).diff(n).abs()/path.replace(0,np.nan)
    rng=(x.high-x.low).replace(0,np.nan); body_high=x[["open","close"]].max(axis=1); body_low=x[["open","close"]].min(axis=1)
    x["uwick"]=(x.high-body_high)/rng; x["lwick"]=(body_low-x.low)/rng; x["cpos"]=(x.close-x.low)/rng
    x["volume_z"]=zscore(np.log1p(x.quote_volume.clip(lower=0)))
    gap=x.open_time.diff().eq(pd.Timedelta(minutes=1)); x["contig6"]=gap.rolling(6,min_periods=6).sum().eq(6)
    return x


def signal(frame: pd.DataFrame,cfg: Config):
    move=frame[f"move{cfg.lookback}"]; imb=frame[f"imb{cfg.lookback}"]; eff=frame[f"eff{cfg.lookback}"]
    if cfg.family=="absorption":
        if cfg.side==1:
            mask=frame.contig6&(move<=-cfg.move_atr)&(imb<=-cfg.imbalance)&(frame.lwick>=cfg.wick)&(frame.cpos>=0.60)&(frame.volume_z>=cfg.volume_z)
            strength=-move-imb+frame.lwick+frame.volume_z.clip(lower=0)/3
        else:
            mask=frame.contig6&(move>=cfg.move_atr)&(imb>=cfg.imbalance)&(frame.uwick>=cfg.wick)&(frame.cpos<=0.40)&(frame.volume_z>=cfg.volume_z)
            strength=move+imb+frame.uwick+frame.volume_z.clip(lower=0)/3
    else:
        if cfg.side==1:
            mask=frame.contig6&(move>=cfg.move_atr)&(imb>=cfg.imbalance)&(frame.cpos>=0.70)&(frame.volume_z>=cfg.volume_z)&(eff>=0.55)
            strength=move+imb+eff+frame.volume_z.clip(lower=0)/3
        else:
            mask=frame.contig6&(move<=-cfg.move_atr)&(imb<=-cfg.imbalance)&(frame.cpos<=0.30)&(frame.volume_z>=cfg.volume_z)&(eff>=0.55)
            strength=-move-imb+eff+frame.volume_z.clip(lower=0)/3
    return mask.fillna(False),strength.replace([np.inf,-np.inf],np.nan).fillna(0)


def crosses(events,entry,exit_):
    if not len(events): return False
    i=np.searchsorted(events,entry,side="left"); return i<len(events) and events[i]<=exit_


def simulate(symbol,frame,funding,cfg,start,end):
    mask,strength=signal(frame,cfg); ts=frame.open_time.astype("int64").to_numpy(); first=np.searchsorted(ts,start.value); final=np.searchsorted(ts,end.value)
    candidates=np.flatnonzero(mask.to_numpy()&(np.arange(len(frame))>=first)&(np.arange(len(frame))<final)); o=frame.open.to_numpy(float); h=frame.high.to_numpy(float); l=frame.low.to_numpy(float); c=frame.close.to_numpy(float); a=frame.atr.to_numpy(float); times=list(frame.open_time); fns=funding.astype("int64").to_numpy(); rows=[]; last_exit=-1
    for sig in candidates:
        if sig<=last_exit or sig+1>=final or not np.isfinite(a[sig]): continue
        side=cfg.side; entry_i=sig+1; limit=c[sig]-side*cfg.offset_atr*a[sig]; penetration=limit*QUEUE_BPS/1e4
        filled=l[entry_i]<=limit-penetration if side==1 else h[entry_i]>=limit+penetration
        if not filled: continue
        scheduled=entry_i+cfg.hold
        if scheduled>=final or times[entry_i].date()!=times[scheduled].date() or crosses(fns,int(ts[entry_i]),int(ts[scheduled])): continue
        stop=limit-side*cfg.stop_atr*a[sig]; risk=abs(limit-stop); target=limit+side*cfg.target_r*risk; exit_price=o[scheduled]; exit_i=scheduled; reason="time"; mae=0.; mfe=0.
        for j in range(entry_i,scheduled):
            ex=(side*(h[j]/limit-1)*1e4,side*(l[j]/limit-1)*1e4); mae=min(mae,*ex); mfe=max(mfe,*ex)
            if side==1 and o[j]<=stop: exit_price,exit_i,reason=o[j],j,"stop_gap"; break
            if side==-1 and o[j]>=stop: exit_price,exit_i,reason=o[j],j,"stop_gap"; break
            if side==1 and l[j]<=stop: exit_price,exit_i,reason=stop,j,"stop"; break
            if side==-1 and h[j]>=stop: exit_price,exit_i,reason=stop,j,"stop"; break
            if j>entry_i and side==1 and h[j]>=target: exit_price,exit_i,reason=target,j,"target"; break
            if j>entry_i and side==-1 and l[j]<=target: exit_price,exit_i,reason=target,j,"target"; break
        gross=side*(exit_price/limit-1)*1e4
        rows.append({"config":cfg.name,"family":cfg.family,"symbol":symbol,"side":side,"signal_time":times[sig],"entry_time":times[entry_i],"exit_time":times[exit_i],"gross_bps":gross,"net10_bps":gross-BASE_COST,"net16_bps":gross-STRESS_COST,"stop_distance_bps":risk/limit*1e4+STRESS_COST,"strength":float(strength.iloc[sig]),"reason":reason,"mae_bps":mae,"mfe_bps":mfe})
        last_exit=exit_i
    return pd.DataFrame(rows)


def metrics(df,col="net16_bps"):
    if df.empty: return {"trades":0,"avg_bps":np.nan,"pf":np.nan,"win_rate":np.nan,"symbols":0,"breadth":0.}
    v=df[col].to_numpy(float); loss=-v[v<0].sum(); by=df.groupby("symbol")[col].agg(["count","mean"]); eligible=by[by["count"]>=20]
    return {"trades":int(len(v)),"avg_bps":float(v.mean()),"pf":float(v[v>0].sum()/loss) if loss else float("inf"),"win_rate":float(np.mean(v>0)),"symbols":int(df.symbol.nunique()),"breadth":float((eligible["mean"]>0).mean()) if len(eligible) else 0.}


def account(df,risk_pct,capital=10000.,max_positions=5,gross_cap=5.):
    data=df.sort_values(["entry_time","strength"],ascending=[True,False]).reset_index(drop=True); equity=capital; open_pos={}; accepted=[]; curve=[]
    for ts in sorted(set(data.entry_time)|set(data.exit_time)):
        for idx,pos in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_time==ts and row.entry_time<ts: pnl=pos*row.net16_bps/1e4; equity+=pnl; accepted.append({**row.to_dict(),"notional":pos,"pnl_usd":pnl,"equity_after":equity}); del open_pos[idx]
        for idx in data.index[data.entry_time==ts]:
            row=data.iloc[idx]
            if len(open_pos)>=max_positions or any(data.iloc[j].symbol==row.symbol for j in open_pos): continue
            notional=min(equity*(risk_pct/100)/(row.stop_distance_bps/1e4),equity); remain=max(0,equity*gross_cap-sum(open_pos.values())); notional=min(notional,remain)
            if notional>0: open_pos[idx]=notional
        for idx,pos in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_time==ts and row.entry_time==ts: pnl=pos*row.net16_bps/1e4; equity+=pnl; accepted.append({**row.to_dict(),"notional":pos,"pnl_usd":pnl,"equity_after":equity}); del open_pos[idx]
        curve.append({"time":ts,"equity":equity})
    c=pd.DataFrame(curve); dd=c.equity/c.equity.cummax()-1
    return {"risk_pct":risk_pct,"end_usd":equity,"return_pct":(equity/capital-1)*100,"closed_dd_pct":-float(dd.min())*100,"trades":len(accepted)}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",required=True,type=Path); ap.add_argument("--cache",required=True,type=Path); ap.add_argument("--workers",type=int,default=32); args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    manifest=download_all(args.cache,args.workers); pd.DataFrame(manifest).to_csv(args.output/"SOURCE_MANIFEST.csv",index=False)
    frames={}; funding={}; coverage=[]
    for symbol in SYMBOLS:
        raw=load_klines(symbol,manifest); f=load_funding(symbol,manifest); coverage.append({"symbol":symbol,"rows":len(raw),"first":None if raw.empty else raw.open_time.iloc[0],"last":None if raw.empty else raw.open_time.iloc[-1],"funding_events":len(f)})
        if len(raw): frames[symbol]=features(raw); funding[symbol]=f
    pd.DataFrame(coverage).to_csv(args.output/"COVERAGE.csv",index=False)
    stores={}; grid=[]
    for cfg in CONFIGS:
        stores[cfg.name]={}
        for label,bounds in {"2025H2":(START,CUT),"2026H1":(CUT,PRE_JULY_END)}.items():
            parts=[simulate(s,frame,funding[s],cfg,*bounds) for s,frame in frames.items()]; t=pd.concat(parts,ignore_index=True) if parts else pd.DataFrame(); stores[cfg.name][label]=t; grid.append({"config":cfg.name,"period":label,**asdict(cfg),**metrics(t)})
    pd.DataFrame(grid).to_csv(args.output/"CONFIG_RESULTS_PRE_JULY.csv",index=False)
    selection=[]
    for cfg in CONFIGS:
        a=metrics(stores[cfg.name]["2025H2"]); b=metrics(stores[cfg.name]["2026H1"]); eligible=(a["trades"]>=500 and b["trades"]>=500 and a["avg_bps"]>0 and b["avg_bps"]>0 and a["pf"]>=1.10 and b["pf"]>=1.10 and a["breadth"]>=0.50 and b["breadth"]>=0.50); score=min(a["avg_bps"],b["avg_bps"])*math.sqrt(min(a["trades"],b["trades"])/500)*min(a["pf"],b["pf"],3) if eligible else -1e9; selection.append({"config":cfg.name,"eligible":eligible,"score":score,**{f"2025H2_{k}":v for k,v in a.items()},**{f"2026H1_{k}":v for k,v in b.items()}})
    selection=pd.DataFrame(selection).sort_values("score",ascending=False); selection.to_csv(args.output/"SELECTION_BEFORE_JULY.csv",index=False)
    chosen_name=str(selection.iloc[0].config); chosen=next(c for c in CONFIGS if c.name==chosen_name); parts=[simulate(s,frame,funding[s],chosen,PRE_JULY_END,JULY_END) for s,frame in frames.items()]; july=pd.concat(parts,ignore_index=True) if parts else pd.DataFrame(); july.to_csv(args.output/"JULY_TRADES.csv",index=False)
    accounts=pd.DataFrame([account(july,r) for r in (0.25,0.5,1,2)]); accounts.to_csv(args.output/"JULY_ACCOUNT_SCENARIOS.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"configs":len(CONFIGS),"eligible_configs":int(selection.eligible.sum()),"chosen":asdict(chosen),"july":metrics(july),"accounts":accounts.to_dict(orient="records"),"selection":selection.to_dict(orient="records")}; (args.output/"SUMMARY.json").write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8"); (args.output/"REPORT_RU.md").write_text("# Round 39 — 1m taker-flow microstructure\n\n```json\n"+json.dumps(summary,indent=2,default=str)+"\n```\n",encoding="utf-8"); print(json.dumps(summary,indent=2,default=str))
if __name__=="__main__": main()
