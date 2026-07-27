from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import json
import math
import time
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

INTERVAL = "15m"
START = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-27", tz="UTC")
WARMUP_START = pd.Timestamp("2026-06-01", tz="UTC")
BASE_COST = 12.0
STRESS_COST = 20.0

# Fixed before reading July results. These symbols did not appear in the prior
# July candidate tables. One common mechanism, exact route selected using only
# 2025 H2 and 2026 H1 metrics.
ROUTES = {
    "PENDLEUSDT": "LONG60",
    "TONUSDT": "LONG45_TIGHT",
    "ZECUSDT": "LONG45_WIDE",
    "TRUMPUSDT": "LONG45_TIGHT",
    "ATOMUSDT": "LONG60",
    "CFXUSDT": "LONG45_WIDE",
    "JUPUSDT": "LONG45_TIGHT",
    "ORDIUSDT": "LONG45_TIGHT",
    "WLDUSDT": "SHORT45_CONTROL",
}

KLINE_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/klines"
KLINE_DAILY = "https://data.binance.vision/data/futures/um/daily/klines"
FUNDING_ENDPOINTS = [
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

@dataclass(frozen=True)
class Variant:
    name: str
    side: int
    hold: int
    stop_atr: float
    target_r: float | None

VARIANTS = {
    "LONG60": Variant("LONG60", 1, 4, 1.5, 2.0),
    "LONG45_TIGHT": Variant("LONG45_TIGHT", 1, 3, 1.25, 2.0),
    "LONG45_WIDE": Variant("LONG45_WIDE", 1, 3, 2.0, 2.0),
    "SHORT45_CONTROL": Variant("SHORT45_CONTROL", -1, 3, 1.5, 2.0),
}

def get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            r = requests.get(url, timeout=timeout, headers={"User-Agent": "altcoin-round18/1"})
            if r.status_code == 404:
                return r
            r.raise_for_status()
            return r
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def fetch_verified(url: str, path: Path) -> dict[str, object]:
    path.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, object] = {"url": url, "path": str(path)}
    try:
        c = get(url + ".CHECKSUM", 60)
        if c.status_code == 404:
            return meta | {"status": "missing"}
        expected = c.text.strip().split()[0].lower()
        if path.exists() and sha256_file(path) == expected:
            return meta | {"status": "cached_verified", "sha256": expected, "bytes": path.stat().st_size}
        r = get(url, 180)
        if r.status_code == 404:
            return meta | {"status": "missing"}
        actual = sha256_bytes(r.content)
        if actual != expected:
            raise RuntimeError(f"checksum {actual} != {expected}")
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(path)
        return meta | {"status": "downloaded_verified", "sha256": actual, "bytes": len(r.content)}
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}

def download_archives(cache: Path, workers: int) -> list[dict[str, object]]:
    tasks: list[tuple[str, str, Path, str, str]] = []
    for symbol in ROUTES:
        month = "2026-06"
        mname = f"{symbol}-{INTERVAL}-{month}.zip"
        murl = f"{KLINE_MONTHLY}/{symbol}/{INTERVAL}/{mname}"
        tasks.append((symbol, murl, cache / "kline" / symbol / mname, month, "monthly"))
        for day in pd.date_range(START, END - pd.Timedelta(days=1), freq="1D"):
            ds = day.strftime("%Y-%m-%d")
            name = f"{symbol}-{INTERVAL}-{ds}.zip"
            url = f"{KLINE_DAILY}/{symbol}/{INTERVAL}/{name}"
            tasks.append((symbol, url, cache / "daily_kline" / symbol / name, ds, "daily"))
    out: list[dict[str, object]] = []
    def one(task: tuple[str, str, Path, str, str]) -> dict[str, object]:
        symbol, url, path, period, kind = task
        return fetch_verified(url, path) | {"symbol": symbol, "period": period, "kind": kind}
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        for i, item in enumerate(pool.map(one, tasks), 1):
            out.append(item)
            if i % 50 == 0:
                print(f"archives {i}/{len(tasks)}", flush=True)
    return out

def read_zip(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        if not names:
            return pd.DataFrame(columns=COLS)
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

def load_symbol(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
    paths = [
        Path(str(x["path"])) for x in manifest
        if x["symbol"] == symbol
        and x["status"] in {"cached_verified","downloaded_verified"}
    ]
    parts = [read_zip(p) for p in sorted(paths)]
    if not parts:
        return pd.DataFrame(columns=COLS)
    f = pd.concat(parts, ignore_index=True).sort_values("open_time").drop_duplicates("open_time")
    return f[(f.open_time >= WARMUP_START) & (f.open_time < END)].reset_index(drop=True)

def funding_events(symbol: str, output: Path) -> pd.DatetimeIndex:
    start_ms = int(START.timestamp() * 1000)
    end_ms = int(END.timestamp() * 1000)
    data = None
    source = None
    for host in FUNDING_ENDPOINTS:
        try:
            r = get(host + f"?symbol={symbol}&startTime={start_ms}&endTime={end_ms}&limit=1000", 60)
            value = r.json()
            if isinstance(value, list):
                data = value
                source = r.url
                break
        except Exception:
            continue
    if data is None:
        idx = pd.date_range(START.floor("8h"), END, freq="8h", tz="UTC")
        (output / f"{symbol}_FUNDING_FALLBACK.json").write_text(
            json.dumps({"kind":"8h_conservative_fallback","timestamps":[x.isoformat() for x in idx]}, indent=2)
        )
        return idx
    raw_path = output / f"{symbol}_FUNDING_RAW.json"
    raw_path.write_text(json.dumps({"source":source,"data":data}, indent=2))
    vals = [int(x["fundingTime"]) for x in data if "fundingTime" in x]
    return pd.DatetimeIndex(pd.to_datetime(pd.Series(vals, dtype="int64"), unit="ms", utc=True).sort_values().drop_duplicates())

def atr(f: pd.DataFrame, n: int = 14) -> pd.Series:
    p = f.close.shift()
    tr = pd.concat([f.high-f.low,(f.high-p).abs(),(f.low-p).abs()],axis=1).max(axis=1)
    return tr.ewm(alpha=1/n, adjust=False, min_periods=n).mean()

def features(raw: pd.DataFrame) -> pd.DataFrame:
    f = raw.copy()
    for c in ["open","high","low","close","volume","quote_volume","taker_buy_base"]:
        f[c] = pd.to_numeric(f[c], errors="coerce")
    f["atr"] = atr(f)
    f["atr_pct"] = f.atr / f.close
    f["move3"] = f.close.pct_change(3) / f.atr_pct.replace(0, np.nan)
    f["imb1"] = (2*f.taker_buy_base/f.volume.replace(0,np.nan)-1).clip(-1,1).fillna(0)
    lv = np.log1p(f.quote_volume.clip(lower=0))
    f["volz"] = (lv-lv.rolling(96,min_periods=48).mean()) / lv.rolling(96,min_periods=48).std().replace(0,np.nan)
    rng = (f.high-f.low).replace(0,np.nan)
    bh = f[["open","close"]].max(axis=1)
    bl = f[["open","close"]].min(axis=1)
    f["uwick"] = (f.high-bh)/rng
    f["lwick"] = (bl-f.low)/rng
    f["cpos"] = (f.close-f.low)/rng
    gap = f.open_time.diff().eq(pd.Timedelta(minutes=15))
    f["contig4"] = gap.rolling(4,min_periods=4).sum().eq(4)
    return f

def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    i = np.searchsorted(events_ns, entry_ns, side="left")
    return i < len(events_ns) and events_ns[i] <= exit_ns

def simulate(symbol: str, f: pd.DataFrame, variant: Variant, events: pd.DatetimeIndex) -> list[dict[str, object]]:
    long = f.contig4 & (f.move3 <= -2.0) & (f.volz >= 1.0) & (f.lwick >= 0.5) & (f.cpos >= 0.55) & (f.imb1 >= -0.1)
    short = f.contig4 & (f.move3 >= 2.0) & (f.volz >= 1.0) & (f.uwick >= 0.5) & (f.cpos <= 0.45) & (f.imb1 <= 0.1)
    mask = long if variant.side == 1 else short
    strength = f.move3.abs() + f.volz.clip(lower=0).fillna(0)/3
    ts = f.open_time.astype("int64").to_numpy()
    first = np.searchsorted(ts, START.value)
    final = np.searchsorted(ts, END.value)
    candidates = np.flatnonzero(mask.fillna(False).to_numpy() & (np.arange(len(f))>=first) & (np.arange(len(f))<final))
    o,h,l,a = [f[c].to_numpy(float) for c in ("open","high","low","atr")]
    times = list(f.open_time)
    ev = events.astype("int64").to_numpy()
    out: list[dict[str, object]] = []
    last_exit = -1
    for si in candidates:
        if si <= last_exit or si+1 >= final or not np.isfinite(a[si]):
            continue
        ei = si+1
        xi = ei+variant.hold
        if xi >= final or times[ei].date()!=times[xi].date() or crosses(ev,int(ts[ei]),int(ts[xi])):
            continue
        side = variant.side
        entry = o[ei]
        stop = entry - side*variant.stop_atr*a[si]
        risk = abs(entry-stop)
        target = None if variant.target_r is None else entry + side*variant.target_r*risk
        exit_price, exit_index, reason = o[xi], xi, "time"
        mae, mfe = 0.0, 0.0
        for bi in range(ei, xi):
            exc = [side*(h[bi]/entry-1)*1e4, side*(l[bi]/entry-1)*1e4]
            mae = min(mae,*exc); mfe=max(mfe,*exc)
            if side==1 and o[bi] <= stop:
                exit_price, exit_index, reason = o[bi], bi, "stop_gap"; break
            if side==-1 and o[bi] >= stop:
                exit_price, exit_index, reason = o[bi], bi, "stop_gap"; break
            if side==1 and l[bi] <= stop:
                exit_price, exit_index, reason = stop, bi, "stop"; break
            if side==-1 and h[bi] >= stop:
                exit_price, exit_index, reason = stop, bi, "stop"; break
            if target is not None and side==1 and h[bi] >= target:
                exit_price, exit_index, reason = target, bi, "target"; break
            if target is not None and side==-1 and l[bi] <= target:
                exit_price, exit_index, reason = target, bi, "target"; break
        gross = side*(exit_price/entry-1)*1e4
        out.append({
            "symbol":symbol,"variant":variant.name,"side":side,
            "signal_time":times[si],"entry_time":times[ei],"exit_time":times[exit_index],
            "gross_bps":gross,"net_bps":gross-BASE_COST,"strength":float(strength.iloc[si]),
            "reason":reason,"mae_bps":mae,"mfe_bps":mfe,
        })
        last_exit = exit_index
    return out

def metrics(df: pd.DataFrame, cost: float = BASE_COST) -> dict[str, float|int]:
    if df.empty:
        return {"trades":0,"avg_bps":np.nan,"pf":np.nan,"win_rate":np.nan,"payoff":np.nan,"total_bps":0.0}
    x = df.gross_bps.to_numpy(float)-cost
    g=x[x>0]; z=-x[x<0]
    return {
        "trades":int(len(x)),"avg_bps":float(x.mean()),
        "pf":float(g.sum()/z.sum()) if z.sum() else float("inf"),
        "win_rate":float((x>0).mean()),
        "payoff":float(g.mean()/z.mean()) if len(g) and len(z) else np.nan,
        "total_bps":float(x.sum()),"best_bps":float(x.max()),"worst_bps":float(x.min()),
    }

def bootstrap(df: pd.DataFrame, n: int = 20000) -> dict[str,float]:
    if df.empty:
        return {"lo":np.nan,"hi":np.nan,"p_positive":np.nan}
    day = pd.to_datetime(df.entry_time,utc=True).dt.floor("D")
    groups=[g.gross_bps.to_numpy(float)-BASE_COST for _,g in df.groupby(day)]
    rng=np.random.default_rng(1801)
    vals=np.empty(n)
    for i in range(n):
        sampled=[groups[j] for j in rng.integers(0,len(groups),len(groups))]
        vals[i]=np.concatenate(sampled).mean()
    return {"lo":float(np.quantile(vals,.025)),"hi":float(np.quantile(vals,.975)),"p_positive":float(np.mean(vals>0))}

def portfolio(df: pd.DataFrame, cost: float, capital: float = 10000.0) -> tuple[dict[str,float|int],pd.DataFrame]:
    if df.empty:
        return {}, pd.DataFrame()
    trades=df.copy()
    trades["net_adjusted"]=trades.gross_bps-cost
    entries={t:list(g.index) for t,g in trades.groupby("entry_time")}
    exits={t:list(g.index) for t,g in trades.groupby("exit_time")}
    equity=capital; open_pos:dict[int,float]={}; accepted=[]
    max_positions=6; fraction=.08
    for t in sorted(set(entries)|set(exits)):
        for idx in exits.get(t,[]):
            if idx in open_pos:
                notion=open_pos.pop(idx); pnl=notion*float(trades.loc[idx,"net_adjusted"])/1e4
                equity+=pnl
                accepted.append(trades.loc[idx].to_dict()|{"notional":notion,"pnl_usd":pnl,"equity_after":equity})
        for idx in sorted(entries.get(t,[]),key=lambda i:float(trades.loc[i,"strength"]),reverse=True):
            if len(open_pos)>=max_positions:
                continue
            symbol=str(trades.loc[idx,"symbol"])
            if any(str(trades.loc[j,"symbol"])==symbol for j in open_pos):
                continue
            open_pos[idx]=equity*fraction
    result={
        "start_usd":capital,"end_usd":equity,"pnl_usd":equity-capital,
        "return_pct":(equity/capital-1)*100,
        "mechanical_annualized_pct":((equity/capital)**(365/26)-1)*100,
        "trades":len(accepted),"trades_per_day":len(accepted)/26,
        "notional_per_position_pct":fraction*100,"max_positions":max_positions,"cost_bps":cost,
    }
    return result,pd.DataFrame(accepted)

def main() -> None:
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",required=True)
    parser.add_argument("--cache",required=True)
    parser.add_argument("--workers",type=int,default=16)
    args=parser.parse_args()
    output=Path(args.output); cache=Path(args.cache)
    output.mkdir(parents=True,exist_ok=True); cache.mkdir(parents=True,exist_ok=True)
    manifest=download_archives(cache,args.workers)
    pd.DataFrame(manifest).to_csv(output/"SOURCE_MANIFEST.csv",index=False)
    all_trades=[]
    coverage=[]
    for symbol, route in ROUTES.items():
        raw=load_symbol(symbol,manifest)
        events=funding_events(symbol,output)
        coverage.append({
            "symbol":symbol,"route":route,"rows":len(raw),
            "first":None if raw.empty else raw.open_time.iloc[0],
            "last":None if raw.empty else raw.open_time.iloc[-1],
            "funding_events":len(events),
        })
        if raw.empty:
            continue
        f=features(raw)
        all_trades += simulate(symbol,f,VARIANTS[route],events)
    pd.DataFrame(coverage).to_csv(output/"COVERAGE.csv",index=False)
    trades=pd.DataFrame(all_trades)
    trades.to_csv(output/"JULY_TRADES.csv",index=False)
    rows=[]
    for symbol,route in ROUTES.items():
        sub=trades[trades.symbol==symbol] if not trades.empty else pd.DataFrame()
        rows.append({"symbol":symbol,"variant":route}|metrics(sub,BASE_COST)|{
            "avg_bps_20":metrics(sub,STRESS_COST)["avg_bps"],
            **{f"boot_{k}":v for k,v in bootstrap(sub).items()},
        })
    ranking=pd.DataFrame(rows).sort_values(["avg_bps_20","avg_bps"],ascending=False)
    ranking.to_csv(output/"JULY_RANKING.csv",index=False)
    agg=metrics(trades,BASE_COST); stress=metrics(trades,STRESS_COST); boot=bootstrap(trades)
    p12,pt12=portfolio(trades,BASE_COST); p20,pt20=portfolio(trades,STRESS_COST)
    pt12.to_csv(output/"PORTFOLIO_TRADES_12BPS.csv",index=False)
    pt20.to_csv(output/"PORTFOLIO_TRADES_20BPS.csv",index=False)
    summary={
        "generated_at":datetime.now(UTC).isoformat(),"routes":ROUTES,
        "aggregate_12bps":agg,"aggregate_20bps":stress,"bootstrap":boot,
        "portfolio_12bps":p12,"portfolio_20bps":p20,
    }
    (output/"SUMMARY.json").write_text(json.dumps(summary,indent=2))
    report=f"""# Round 18 — fresh July cohort

Nine routes were fixed before reading their July 2026 outcomes. The symbols were absent from the previous July candidate tables.

## Ranking

{ranking.to_markdown(index=False,floatfmt=".2f")}

## Aggregate

```json
{json.dumps(summary,indent=2)}
```

The 26-day window is too short for final confidence. Mechanical annualization is not a forecast.
"""
    (output/"REPORT_RU.md").write_text(report)
    (output/"SHA256SUMS.txt").write_text("\n".join(f"{sha256_file(p)}  {p.name}" for p in sorted(output.iterdir()) if p.is_file() and p.name!="SHA256SUMS.txt")+"\n")
    print(json.dumps(summary,indent=2))

if __name__=="__main__":
    main()
