from __future__ import annotations

import hashlib
import io
import json
import time
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from backtest import Exec, Rule, metrics, simulate
from features import build

SYMBOLS = ["1000BONKUSDT", "OPUSDT"]
START = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-27", tz="UTC")
WARMUP = pd.Timestamp("2026-06-01", tz="UTC")
INTERVAL = "5m"
BASE_COST = 12.0
STRESS_COST = 20.0

KLINE_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/klines"
KLINE_DAILY = "https://data.binance.vision/data/futures/um/daily/klines"
FUNDING_HOSTS = [
    "https://fapi.binance.com/fapi/v1/fundingRate",
    "https://fapi1.binance.com/fapi/v1/fundingRate",
    "https://fapi2.binance.com/fapi/v1/fundingRate",
    "https://fapi3.binance.com/fapi/v1/fundingRate",
    "https://fapi4.binance.com/fapi/v1/fundingRate",
]
COLS = [
    "open_time","open","high","low","close","volume","close_time",
    "quote_volume","trades","taker_buy_base","taker_buy_quote","ignore",
]

RULE = Rule("sweep", {"n": 96, "wick": 0.6, "imb": 0.0}, "sweep-a3528c5a")
EXECUTION = Exec(passive=True, offset=0.25, hold=18, stop=None, target=None, cost=BASE_COST, queue=1.0)

def get(url: str, timeout: int = 120) -> requests.Response:
    last = None
    for attempt in range(5):
        try:
            r = requests.get(url, timeout=timeout, headers={"User-Agent": "altcoin-round21/1"})
            if r.status_code == 404:
                return r
            r.raise_for_status()
            return r
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")

def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def fetch(url: str, path: Path) -> dict[str, object]:
    path.parent.mkdir(parents=True, exist_ok=True)
    base = {"url": url, "path": str(path)}
    try:
        c = get(url + ".CHECKSUM", 60)
        if c.status_code == 404:
            return base | {"status": "missing"}
        expected = c.text.strip().split()[0].lower()
        if path.exists() and sha(path) == expected:
            return base | {"status": "cached_verified", "sha256": expected, "bytes": path.stat().st_size}
        r = get(url, 180)
        if r.status_code == 404:
            return base | {"status": "missing"}
        actual = hashlib.sha256(r.content).hexdigest()
        if actual != expected:
            raise RuntimeError(f"checksum {actual} != {expected}")
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(path)
        return base | {"status": "downloaded_verified", "sha256": actual, "bytes": len(r.content)}
    except Exception as exc:
        return base | {"status": "error", "error": str(exc)}

def read_zip(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        raw = z.read(names[0])
    f = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False).iloc[:, :12]
    f.columns = COLS
    for c in COLS[:-1]:
        f[c] = pd.to_numeric(f[c], errors="coerce")
    f = f.dropna(subset=["open_time","open","high","low","close","volume"])
    if len(f) and f.open_time.median() > 1e14:
        f.open_time /= 1000
    f.open_time = pd.to_datetime(f.open_time.astype("int64"), unit="ms", utc=True)
    return f

def load_symbol(symbol: str, cache: Path) -> tuple[pd.DataFrame, list[dict[str, object]]]:
    manifest = []
    paths = []
    month = "2026-06"
    name = f"{symbol}-{INTERVAL}-{month}.zip"
    url = f"{KLINE_MONTHLY}/{symbol}/{INTERVAL}/{name}"
    path = cache / "kline" / symbol / name
    item = fetch(url, path) | {"symbol": symbol, "period": month, "kind": "monthly"}
    manifest.append(item)
    if item["status"] in {"cached_verified","downloaded_verified"}:
        paths.append(path)
    for day in pd.date_range(START, END-pd.Timedelta(days=1), freq="1D"):
        ds = day.strftime("%Y-%m-%d")
        name = f"{symbol}-{INTERVAL}-{ds}.zip"
        url = f"{KLINE_DAILY}/{symbol}/{INTERVAL}/{name}"
        path = cache / "daily_kline" / symbol / name
        item = fetch(url, path) | {"symbol": symbol, "period": ds, "kind": "daily"}
        manifest.append(item)
        if item["status"] in {"cached_verified","downloaded_verified"}:
            paths.append(path)
    parts = [read_zip(p) for p in paths]
    if not parts:
        return pd.DataFrame(columns=COLS), manifest
    f = pd.concat(parts, ignore_index=True).sort_values("open_time").drop_duplicates("open_time")
    return f[(f.open_time >= WARMUP) & (f.open_time < END)].reset_index(drop=True), manifest

def funding(symbol: str, output: Path) -> pd.DatetimeIndex:
    start_ms = int(START.timestamp()*1000)
    end_ms = int(END.timestamp()*1000)
    for host in FUNDING_HOSTS:
        try:
            r = get(host + f"?symbol={symbol}&startTime={start_ms}&endTime={end_ms}&limit=1000", 60)
            data = r.json()
            if isinstance(data, list):
                (output/f"{symbol}_FUNDING_RAW.json").write_text(json.dumps({"url":r.url,"data":data},indent=2))
                vals = [int(x["fundingTime"]) for x in data if "fundingTime" in x]
                return pd.DatetimeIndex(pd.to_datetime(pd.Series(vals,dtype="int64"),unit="ms",utc=True).sort_values().drop_duplicates())
        except Exception:
            pass
    idx = pd.date_range(START.floor("8h"),END,freq="8h",tz="UTC")
    (output/f"{symbol}_FUNDING_FALLBACK.json").write_text(json.dumps({"timestamps":[x.isoformat() for x in idx]},indent=2))
    return idx

def bootstrap(df: pd.DataFrame, n: int = 30000) -> dict[str,float]:
    if df.empty:
        return {"lo":np.nan,"hi":np.nan,"p_positive":np.nan}
    day = pd.to_datetime(df.entry_time,utc=True).dt.floor("D")
    groups=[g.net_bps.to_numpy(float) for _,g in df.groupby(day)]
    rng=np.random.default_rng(2101)
    vals=np.empty(n)
    for i in range(n):
        vals[i]=np.concatenate([groups[j] for j in rng.integers(0,len(groups),len(groups))]).mean()
    return {"lo":float(np.quantile(vals,.025)),"hi":float(np.quantile(vals,.975)),"p_positive":float(np.mean(vals>0))}

def portfolio(df: pd.DataFrame, cost: float, capital: float = 10_000.0) -> dict[str,float|int]:
    if df.empty:
        return {}
    x=df.sort_values("entry_time").copy()
    x["adjusted"]=x.gross_bps-cost
    equity=capital
    for _,r in x.iterrows():
        equity += equity*0.10*float(r.adjusted)/1e4
    days=(END-START).days
    return {
        "start_usd":capital,"end_usd":equity,"pnl_usd":equity-capital,
        "return_pct":(equity/capital-1)*100,
        "mechanical_annualized_pct":((equity/capital)**(365/days)-1)*100,
        "trades":len(x),"trades_per_day":len(x)/days,
        "notional_per_position_pct":10.0,"cost_bps":cost,
    }

def main() -> None:
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",required=True)
    parser.add_argument("--cache",required=True)
    args=parser.parse_args()
    output=Path(args.output); cache=Path(args.cache)
    output.mkdir(parents=True,exist_ok=True); cache.mkdir(parents=True,exist_ok=True)
    manifest=[]; trades=[]; coverage=[]
    for symbol in SYMBOLS:
        raw, items=load_symbol(symbol,cache); manifest += items
        ev=funding(symbol,output)
        coverage.append({"symbol":symbol,"rows":len(raw),"first":None if raw.empty else raw.open_time.iloc[0],"last":None if raw.empty else raw.open_time.iloc[-1],"funding_events":len(ev)})
        if raw.empty: continue
        trades += simulate(symbol,build(raw),RULE,EXECUTION,START,END,ev.astype("int64").to_numpy())
    pd.DataFrame(manifest).to_csv(output/"SOURCE_MANIFEST.csv",index=False)
    pd.DataFrame(coverage).to_csv(output/"COVERAGE.csv",index=False)
    df=pd.DataFrame(trades); df.to_csv(output/"JULY_TRADES.csv",index=False)
    rows=[]
    for symbol in SYMBOLS:
        sub=df[df.symbol==symbol] if not df.empty else pd.DataFrame()
        base=metrics(sub); stress=metrics(sub.assign(net_bps=sub.gross_bps-STRESS_COST)) if not sub.empty else metrics(sub)
        rows.append({"symbol":symbol,**{f"base_{k}":v for k,v in base.items()},**{f"stress20_{k}":v for k,v in stress.items()},**{f"boot_{k}":v for k,v in bootstrap(sub).items()}})
    ranking=pd.DataFrame(rows).sort_values("base_avg_bps",ascending=False); ranking.to_csv(output/"JULY_RANKING.csv",index=False)
    base=metrics(df); stress=metrics(df.assign(net_bps=df.gross_bps-STRESS_COST)) if not df.empty else metrics(df)
    summary={"generated_at":datetime.now(UTC).isoformat(),"rule":{"family":"sweep","params":RULE.params},"execution":EXECUTION.__dict__,"base12":base,"stress20":stress,"bootstrap":bootstrap(df),"portfolio12":portfolio(df,BASE_COST),"portfolio20":portfolio(df,STRESS_COST)}
    (output/"SUMMARY.json").write_text(json.dumps(summary,indent=2))
    (output/"REPORT_RU.md").write_text(f"# Round 21 — fixed sweep July check\n\n{ranking.to_markdown(index=False,floatfmt='.2f')}\n\n```json\n{json.dumps(summary,indent=2)}\n```\n")
    print(json.dumps(summary,indent=2))

if __name__=="__main__":
    main()
