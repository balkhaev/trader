#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import time
import zipfile
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from lightgbm import LGBMRegressor

SYMBOLS = ["BTCUSDT", "ETHUSDT"]
START_DOWNLOAD = pd.Timestamp("2024-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
TRAIN_START = pd.Timestamp("2024-02-12", tz="UTC")
TRAIN_END = pd.Timestamp("2024-05-01", tz="UTC") - pd.Timedelta(minutes=65)
TEST_START = pd.Timestamp("2024-09-01", tz="UTC")
COST_BPS = 12.0
STRESS_COST_BPS = 16.0
QUEUE_BPS = 1.0
STRESS_QUEUE_BPS = 3.0
THRESHOLD_BPS = 15.0
SESSION_START = 6
SESSION_END = 22
OFFSET_ATR = 0.20
HOLD_BARS = 18

KLINE_BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
FUND_BASE = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
KLINE_COLS = [
    "open_time","open","high","low","close","volume","close_time",
    "quote_volume","trades","taker_buy_base","taker_buy_quote","ignore",
]

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1<<20),b""):
            h.update(chunk)
    return h.hexdigest()

def get(url: str, timeout: int=180) -> requests.Response:
    last=None
    for attempt in range(6):
        try:
            r=requests.get(url,timeout=timeout,headers={"User-Agent":"hf90-round32-rebuilt/1"})
            if r.status_code==404:
                return r
            r.raise_for_status()
            return r
        except Exception as exc:
            last=exc
            time.sleep(2+attempt*2)
    raise RuntimeError(f"{url}: {last}")

def download_verified(url: str, path: Path) -> dict:
    path.parent.mkdir(parents=True,exist_ok=True)
    check=get(url+".CHECKSUM",60)
    if check.status_code==404:
        return {"url":url,"path":str(path),"status":"missing"}
    text=check.text
    m=re.search(r"\b([0-9a-fA-F]{64})\b",text)
    if not m:
        raise RuntimeError(f"invalid checksum {url}")
    expected=m.group(1).lower()
    Path(str(path)+".CHECKSUM").write_text(text,encoding="utf-8")
    if path.exists() and sha256(path)==expected:
        return {"url":url,"path":str(path),"status":"cached_verified","sha256":expected,"bytes":path.stat().st_size}
    r=get(url,240)
    if r.status_code==404:
        return {"url":url,"path":str(path),"status":"missing"}
    actual=hashlib.sha256(r.content).hexdigest()
    if actual!=expected:
        raise RuntimeError(f"sha mismatch {url}: {actual} != {expected}")
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_bytes(r.content); tmp.replace(path)
    return {"url":url,"path":str(path),"status":"downloaded_verified","sha256":actual,"bytes":len(r.content)}

def month_strings() -> list[str]:
    return [p.strftime("%Y-%m") for p in pd.period_range("2024-01","2026-06",freq="M")]

def download_all(root: Path) -> list[dict]:
    rows=[]
    for symbol in SYMBOLS:
        for month in month_strings():
            name=f"{symbol}-5m-{month}.zip"
            rows.append(download_verified(f"{KLINE_BASE}/{symbol}/5m/{name}",root/"klines"/symbol/name))
            fname=f"{symbol}-fundingRate-{month}.zip"
            rows.append(download_verified(f"{FUND_BASE}/{symbol}/{fname}",root/"fundingRate"/symbol/fname))
            print(symbol,month,flush=True)
    return rows

def load_klines(root: Path, symbol: str) -> pd.DataFrame:
    parts=[]
    for path in sorted((root/"klines"/symbol).glob(f"{symbol}-5m-*.zip")):
        with zipfile.ZipFile(path) as z:
            members=[n for n in z.namelist() if not n.endswith("/")]
            raw=z.read(members[0])
        first=raw.splitlines()[0].decode("utf-8",errors="replace").lower()
        header=("open_time" in first or "open time" in first)
        df=pd.read_csv(io.BytesIO(raw),header=0 if header else None,low_memory=False)
        if header:
            df.columns=[str(c).strip().lower().replace(" ","_") for c in df.columns]
        else:
            df=df.iloc[:,:12]; df.columns=KLINE_COLS[:df.shape[1]]
        required=["open_time","open","high","low","close","volume"]
        if not set(required).issubset(df.columns):
            raise ValueError(f"missing columns {path}: {df.columns}")
        df=df[required].copy()
        numeric=pd.to_numeric(df.open_time,errors="coerce")
        numeric=numeric.where(numeric<1e14,numeric//1000)
        df["ts"]=pd.to_datetime(numeric,unit="ms",utc=True,errors="coerce")
        for c in ["open","high","low","close","volume"]:
            df[c]=pd.to_numeric(df[c],errors="coerce")
        parts.append(df.dropna())
    out=pd.concat(parts,ignore_index=True).sort_values("ts").drop_duplicates("ts")
    return out[(out.ts>=START_DOWNLOAD)&(out.ts<END)].set_index("ts")[["open","high","low","close","volume"]]

def load_funding(root: Path, symbol: str) -> pd.DataFrame:
    rows=[]
    for path in sorted((root/"fundingRate"/symbol).glob(f"{symbol}-fundingRate-*.zip")):
        with zipfile.ZipFile(path) as z:
            raw=z.read([n for n in z.namelist() if not n.endswith("/")][0])
        df=pd.read_csv(io.BytesIO(raw),low_memory=False)
        if "calc_time" in df.columns:
            ts=pd.to_numeric(df.calc_time,errors="coerce")
            rate=pd.to_numeric(df.get("last_funding_rate",df.iloc[:,-1]),errors="coerce")
        else:
            rawdf=pd.read_csv(io.BytesIO(raw),header=None,low_memory=False)
            ts=pd.to_numeric(rawdf.iloc[:,0],errors="coerce")
            rate=pd.to_numeric(rawdf.iloc[:,-1],errors="coerce")
        ts=ts.where(ts<1e14,ts//1000)
        rows.append(pd.DataFrame({"funding_ts":pd.to_datetime(ts,unit="ms",utc=True,errors="coerce"),"funding_rate":rate}))
    if not rows:
        return pd.DataFrame(columns=["funding_ts","funding_rate"])
    return pd.concat(rows,ignore_index=True).dropna().sort_values("funding_ts").drop_duplicates("funding_ts")

def true_range(d):
    pc=d.close.shift()
    return pd.concat([d.high-d.low,(d.high-pc).abs(),(d.low-pc).abs()],axis=1).max(axis=1)

def atr(d,n=14):
    return true_range(d).ewm(alpha=1/n,adjust=False).mean()

def rsi(s,n=14):
    delta=s.diff(); up=delta.clip(lower=0); down=(-delta).clip(lower=0)
    au=up.ewm(alpha=1/n,adjust=False).mean()
    ad=down.ewm(alpha=1/n,adjust=False).mean()
    return 100-100/(1+au/(ad+1e-12))

def features(d: pd.DataFrame, other: pd.DataFrame) -> pd.DataFrame:
    f=pd.DataFrame(index=d.index)
    c,o,h,l,v=d.close,d.open,d.high,d.low,d.volume
    logc=np.log(c)
    for n in [1,2,3,6,12,24,48,96,288]:
        f[f"ret_{n}"]=logc.diff(n)
    a=atr(d,14)
    f["atr_pct"]=a/c
    f["range_atr"]=(h-l)/(a+1e-12)
    f["body_atr"]=(c-o)/(a+1e-12)
    f["close_loc"]=(c-l)/(h-l+1e-12)
    f["rsi14"]=(rsi(c,14)-50)/50
    f["rsi5"]=(rsi(c,5)-50)/50
    for n in [8,20,50,100]:
        e=c.ewm(span=n,adjust=False).mean()
        f[f"ema_gap_{n}"]=c/e-1
    f["ema20_50"]=c.ewm(span=20,adjust=False).mean()/c.ewm(span=50,adjust=False).mean()-1
    for n in [12,24,48,96,288]:
        mean,std=c.rolling(n).mean(),c.rolling(n).std()
        f[f"z_{n}"]=(c-mean)/(std+1e-12)
        f[f"vol_{n}"]=logc.diff().rolling(n).std()
        vm,vs=v.rolling(n).mean(),v.rolling(n).std()
        f[f"volz_{n}"]=(v-vm)/(vs+1e-12)
    typ=(h+l+c)/3
    for n in [12,48,288]:
        rv=(typ*v).rolling(n).sum()/(v.rolling(n).sum()+1e-12)
        f[f"vwap_gap_{n}"]=c/rv-1
    for n in [12,24,48,96]:
        hh,ll=h.shift(1).rolling(n).max(),l.shift(1).rolling(n).min()
        f[f"channel_pos_{n}"]=(c-ll)/(hh-ll+1e-12)-0.5
        f[f"dist_hi_{n}"]=(c-hh)/(a+1e-12)
        f[f"dist_lo_{n}"]=(c-ll)/(a+1e-12)
    oc=other.close.reindex(d.index); olog=np.log(oc)
    for n in [1,2,3,6,12,24,48]:
        f[f"other_ret_{n}"]=olog.diff(n)
        f[f"rel_ret_{n}"]=logc.diff(n)-olog.diff(n)
        f[f"agree_{n}"]=np.sign(logc.diff(n))*np.sign(olog.diff(n))
    mins=d.index.hour*60+d.index.minute
    f["tod_sin"]=np.sin(2*np.pi*mins/1440)
    f["tod_cos"]=np.cos(2*np.pi*mins/1440)
    f["dow_sin"]=np.sin(2*np.pi*d.index.dayofweek/7)
    f["dow_cos"]=np.cos(2*np.pi*d.index.dayofweek/7)
    f["is_weekend"]=(d.index.dayofweek>=5).astype(float)
    return f.replace([np.inf,-np.inf],np.nan)

def simulate(symbol,d,pred,funding,start,end,cost,queue):
    a=atr(d,14); block=pd.Timestamp.min.tz_localize("UTC"); rows=[]
    eligible=pred[(pred.abs()>=THRESHOLD_BPS)&pred.notna()].index
    for ts in eligible:
        if ts<start or ts>=end or ts.hour<SESSION_START or ts.hour>=SESSION_END or ts<=block:
            continue
        pos=d.index.get_loc(ts); side=1 if pred.loc[ts]>0 else -1
        limit=d.close.iloc[pos]-side*OFFSET_ATR*a.iloc[pos]
        fill_pos=pos+1
        if fill_pos>=len(d) or d.index[fill_pos].date()!=ts.date():
            continue
        pen=limit*queue/1e4
        fill=d.low.iloc[fill_pos]<=limit-pen if side>0 else d.high.iloc[fill_pos]>=limit+pen
        if not fill:
            block=d.index[fill_pos]; continue
        exit_pos=fill_pos+HOLD_BARS
        if exit_pos>=len(d) or d.index[exit_pos].date()!=ts.date():
            continue
        entry_ts,exit_ts=d.index[fill_pos],d.index[exit_pos]
        exit_price=d.open.iloc[exit_pos]
        price_bps=side*(exit_price/limit-1)*1e4
        events=funding[(funding.funding_ts>entry_ts)&(funding.funding_ts<=exit_ts)]
        funding_bps=float((-side*events.funding_rate*1e4).sum())
        rows.append({"symbol":symbol,"signal_ts":ts,"entry_ts":entry_ts,"exit_ts":exit_ts,"side":"LONG" if side>0 else "SHORT","prediction_bps":float(pred.loc[ts]),"entry_price":float(limit),"exit_price":float(exit_price),"price_return_bps":float(price_bps),"cost_bps":float(cost),"funding_bps":funding_bps,"net_return_bps":float(price_bps-cost+funding_bps),"hold_bars":HOLD_BARS})
        block=exit_ts
    return pd.DataFrame(rows)

def pf(x):
    x=np.asarray(x,float); loss=-x[x<0].sum()
    return float(x[x>0].sum()/loss) if loss>0 else float("inf")

def metrics(t):
    if t.empty: return {"trades":0,"mean_bps":None,"pf":None,"win_rate":None}
    x=t.net_return_bps.to_numpy(float)
    return {"trades":int(len(x)),"mean_bps":float(x.mean()),"pf":pf(x),"win_rate":float(np.mean(x>0))}

def account(t,fraction,capital=10000.):
    data=t.sort_values(["entry_ts","symbol"]).reset_index(drop=True)
    equity=capital; open_pos={}; accepted=[]; curve=[]
    for ts in sorted(set(data.entry_ts)|set(data.exit_ts)):
        for idx,notional in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_ts==ts and row.entry_ts<ts:
                pnl=notional*row.net_return_bps/1e4; equity+=pnl
                accepted.append({**row.to_dict(),"notional":notional,"pnl_usd":pnl,"equity_after":equity})
                del open_pos[idx]
        for idx in data.index[data.entry_ts==ts]:
            row=data.iloc[idx]
            if any(data.iloc[j].symbol==row.symbol for j in open_pos): continue
            open_pos[idx]=equity*fraction
        for idx,notional in list(open_pos.items()):
            row=data.iloc[idx]
            if row.exit_ts==ts and row.entry_ts==ts:
                pnl=notional*row.net_return_bps/1e4; equity+=pnl
                accepted.append({**row.to_dict(),"notional":notional,"pnl_usd":pnl,"equity_after":equity})
                del open_pos[idx]
        curve.append({"time":ts,"equity":equity})
    c=pd.DataFrame(curve); dd=c.equity/c.equity.cummax()-1
    days=(END-TEST_START).days
    return {"fraction_per_symbol":fraction,"max_gross_pct":fraction*200,"end_usd":float(equity),"pnl_usd":float(equity-capital),"return_pct":float((equity/capital-1)*100),"annualized_pct":float(((equity/capital)**(365/days)-1)*100) if equity>0 else -100.,"closed_dd_pct":float(-dd.min()*100),"trades":len(accepted)}

def bootstrap(t,n=20000):
    x=t.copy(); x["day"]=x.entry_ts.dt.floor("D")
    groups=[g.net_return_bps.to_numpy(float) for _,g in x.groupby("day")]
    rng=np.random.default_rng(3201); means=np.empty(n)
    for i in range(n):
        means[i]=np.concatenate([groups[j] for j in rng.integers(0,len(groups),len(groups))]).mean()
    return {"lo":float(np.quantile(means,.025)),"hi":float(np.quantile(means,.975)),"p_positive":float(np.mean(means>0))}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",required=True,type=Path); ap.add_argument("--cache",required=True,type=Path); ap.add_argument("--workers",type=int,default=8)
    args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    manifest=download_all(args.cache)
    (args.output/"SOURCE_MANIFEST.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    data={s:load_klines(args.cache,s) for s in SYMBOLS}
    common=data["BTCUSDT"].index.intersection(data["ETHUSDT"].index); data={s:data[s].loc[common] for s in SYMBOLS}
    funding={s:load_funding(args.cache,s) for s in SYMBOLS}
    frames=[]; feature_cols=None; symbol_features={}
    for i,s in enumerate(SYMBOLS):
        other=SYMBOLS[1-i]; x=features(data[s],data[other]); x["symbol_eth"]=float(i==1); symbol_features[s]=x
        if feature_cols is None: feature_cols=x.columns.tolist()
        entry=data[s].open.shift(-1); exitp=data[s].open.shift(-13)
        q=x.copy(); q["target_bps"]=(exitp/entry-1)*1e4; q["symbol"]=s; q["ts"]=q.index; frames.append(q.reset_index(drop=True))
    allx=pd.concat(frames,ignore_index=True); train=(allx.ts>=TRAIN_START)&(allx.ts<TRAIN_END)&allx.target_bps.notna()
    model=LGBMRegressor(n_estimators=120,learning_rate=0.035,num_leaves=15,max_depth=4,min_child_samples=100,reg_lambda=10,objective="regression_l1",verbosity=-1,n_jobs=8,random_state=37)
    model.fit(allx.loc[train,feature_cols].astype("float32"),allx.loc[train,"target_bps"].astype("float32"))
    joblib.dump(model,args.output/"MODEL.joblib"); (args.output/"FEATURES.json").write_text(json.dumps(feature_cols,indent=2),encoding="utf-8")
    spec={"training_start":TRAIN_START.isoformat(),"training_end_exclusive":TRAIN_END.isoformat(),"training_rows":int(train.sum()),"feature_count":len(feature_cols),"params":model.get_params()}; (args.output/"MODEL_SPEC.json").write_text(json.dumps(spec,indent=2,default=str),encoding="utf-8")
    base=[]; stress=[]
    for s in SYMBOLS:
        x=symbol_features[s]; pred=pd.Series(model.predict(x[feature_cols].astype("float32")),index=x.index)
        base.append(simulate(s,data[s],pred,funding[s],TEST_START,END,COST_BPS,QUEUE_BPS)); stress.append(simulate(s,data[s],pred,funding[s],TEST_START,END,STRESS_COST_BPS,STRESS_QUEUE_BPS))
    base=pd.concat(base,ignore_index=True).sort_values(["entry_ts","symbol"]); stress=pd.concat(stress,ignore_index=True).sort_values(["entry_ts","symbol"])
    base.to_csv(args.output/"TRADES_BASE.csv",index=False); stress.to_csv(args.output/"TRADES_STRESS.csv",index=False)
    periods={"2024Q4":(pd.Timestamp("2024-09-01",tz="UTC"),pd.Timestamp("2025-01-01",tz="UTC")),"2025":(pd.Timestamp("2025-01-01",tz="UTC"),pd.Timestamp("2026-01-01",tz="UTC")),"2026H1":(pd.Timestamp("2026-01-01",tz="UTC"),END),"full":(TEST_START,END)}
    rows=[]
    for label,(a,b) in periods.items():
        g=base[(base.entry_ts>=a)&(base.entry_ts<b)]; gs=stress[(stress.entry_ts>=a)&(stress.entry_ts<b)]; rows.append({"period":label,**{f"base_{k}":v for k,v in metrics(g).items()},**{f"stress_{k}":v for k,v in metrics(gs).items()}})
    pd.DataFrame(rows).to_csv(args.output/"PERIOD_METRICS.csv",index=False)
    accounts=[account(base,f) for f in (.10,.25,.50,1.0,1.5,2.0)]; pd.DataFrame(accounts).to_csv(args.output/"ACCOUNT_SCENARIOS.csv",index=False)
    by_symbol={k:metrics(g) for k,g in base.groupby("symbol")}; by_side={k:metrics(g) for k,g in base.groupby("side")}; top20=base.sort_values("net_return_bps",ascending=False).iloc[20:]
    result={"model_spec":spec,"base":metrics(base),"stress":metrics(stress),"periods":rows,"by_symbol":by_symbol,"by_side":by_side,"bootstrap":bootstrap(base),"without_top20":metrics(top20),"accounts":accounts,"funding_total_bps":float(base.funding_bps.sum())}
    (args.output/"SUMMARY.json").write_text(json.dumps(result,indent=2,default=str),encoding="utf-8"); (args.output/"REPORT_RU.md").write_text("# HF90 rebuilt official replay\n\n```json\n"+json.dumps(result,indent=2,default=str)+"\n```\n",encoding="utf-8"); print(json.dumps(result,indent=2,default=str))
if __name__=="__main__": main()
