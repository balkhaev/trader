from __future__ import annotations

import argparse
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

SYMBOLS = ["OPUSDT", "TIAUSDT", "ETCUSDT", "LINKUSDT", "INJUSDT", "SUIUSDT"]
START = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-27", tz="UTC")
WARMUP_START = pd.Timestamp("2026-06-01", tz="UTC")
BASE_COST_BPS = 12.0
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
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


def get(url: str, timeout: int = 90) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(url, timeout=timeout, headers={"User-Agent": "altcoin-round16/1"})
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def fetch_verified_zip(url: str, path: Path) -> dict[str, object]:
    path.parent.mkdir(parents=True, exist_ok=True)
    checksum = get(url + ".CHECKSUM", 60)
    if checksum.status_code == 404:
        return {"url": url, "path": str(path), "status": "missing"}
    expected = checksum.text.strip().split()[0].lower()
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
        return {"url": url, "path": str(path), "status": "cached_verified", "sha256": expected, "bytes": path.stat().st_size}
    response = get(url, 180)
    if response.status_code == 404:
        return {"url": url, "path": str(path), "status": "missing"}
    actual = hashlib.sha256(response.content).hexdigest()
    if actual != expected:
        raise RuntimeError(f"checksum mismatch {url}: {actual} != {expected}")
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(response.content)
    tmp.replace(path)
    return {"url": url, "path": str(path), "status": "downloaded_verified", "sha256": actual, "bytes": len(response.content)}


def parse_zip(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as bundle:
        names = [n for n in bundle.namelist() if not n.endswith("/")]
        raw = bundle.read(names[0])
    frame = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False).iloc[:, :12]
    frame.columns = COLS
    for col in COLS[:-1]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    frame = frame.dropna(subset=["open_time", "open", "high", "low", "close", "volume"])
    if len(frame) and frame.open_time.median() > 1e14:
        frame.open_time /= 1000
    frame.open_time = pd.to_datetime(frame.open_time.astype("int64"), unit="ms", utc=True)
    return frame


def load_symbol(symbol: str, cache: Path) -> tuple[pd.DataFrame, list[dict[str, object]]]:
    manifest: list[dict[str, object]] = []
    paths: list[Path] = []
    month_name = f"{symbol}-15m-2026-06.zip"
    month_url = f"{KLINE_MONTHLY}/{symbol}/15m/{month_name}"
    month_path = cache / symbol / month_name
    item = fetch_verified_zip(month_url, month_path)
    item.update({"symbol": symbol, "date": "2026-06", "kind": "monthly_kline"})
    manifest.append(item)
    if item["status"] in {"cached_verified", "downloaded_verified"}:
        paths.append(month_path)
    for day in pd.date_range(START, END - pd.Timedelta(days=1), freq="1D"):
        date = day.strftime("%Y-%m-%d")
        name = f"{symbol}-15m-{date}.zip"
        url = f"{KLINE_DAILY}/{symbol}/15m/{name}"
        path = cache / symbol / name
        item = fetch_verified_zip(url, path)
        item.update({"symbol": symbol, "date": date, "kind": "daily_kline"})
        manifest.append(item)
        if item["status"] in {"cached_verified", "downloaded_verified"}:
            paths.append(path)
    parts = [parse_zip(p) for p in paths]
    if not parts:
        return pd.DataFrame(columns=COLS), manifest
    frame = pd.concat(parts, ignore_index=True)
    frame = frame[(frame.open_time >= WARMUP_START) & (frame.open_time < END)].sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
    return frame, manifest


def fetch_funding(symbol: str, output: Path) -> pd.DatetimeIndex:
    params = {
        "symbol": symbol,
        "startTime": int(START.timestamp() * 1000),
        "endTime": int(END.timestamp() * 1000) - 1,
        "limit": 1000,
    }
    last: Exception | None = None
    records: list[dict[str, object]] | None = None
    used_url = None
    for host in FUNDING_HOSTS:
        try:
            response = requests.get(host, params=params, timeout=60, headers={"User-Agent": "altcoin-round16/1"})
            response.raise_for_status()
            data = response.json()
            if isinstance(data, list):
                records = data
                used_url = response.url
                break
        except Exception as exc:
            last = exc
    fallback = records is None
    if fallback:
        schedule = pd.date_range(START.floor("8h"), END, freq="8h", tz="UTC")
        records = [{"fundingTime": int(ts.timestamp()*1000), "source": "standard_8h_fallback"} for ts in schedule]
    path = output / "funding_raw" / f"{symbol}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, indent=2), encoding="utf-8")
    meta = {
        "symbol": symbol,
        "url": used_url,
        "records": len(records),
        "source": "standard_8h_fallback" if fallback else "public_usdm_endpoint",
        "endpoint_error": None if not fallback else str(last),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    (output / "funding_raw" / f"{symbol}.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    if not records:
        return pd.DatetimeIndex([], tz="UTC")
    values = pd.to_numeric(pd.Series([x.get("fundingTime") for x in records]), errors="coerce").dropna().astype("int64")
    return pd.DatetimeIndex(pd.to_datetime(values, unit="ms", utc=True).drop_duplicates().sort_values())


def atr(frame: pd.DataFrame, periods: int = 14) -> pd.Series:
    prev = frame.close.shift()
    tr = pd.concat([(frame.high-frame.low), (frame.high-prev).abs(), (frame.low-prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1/periods, adjust=False, min_periods=periods).mean()


def build(frame: pd.DataFrame) -> pd.DataFrame:
    f = frame.copy()
    for col in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_base"]:
        f[col] = pd.to_numeric(f[col], errors="coerce")
    f["atr"] = atr(f)
    f["atr_pct"] = f.atr / f.close
    f["move3"] = f.close.pct_change(3) / f.atr_pct.replace(0, np.nan)
    f["imb1"] = (2*f.taker_buy_base/f.volume.replace(0, np.nan)-1).clip(-1,1).fillna(0)
    lv = np.log1p(f.quote_volume.clip(lower=0))
    mean = lv.rolling(96, min_periods=48).mean()
    std = lv.rolling(96, min_periods=48).std().replace(0, np.nan)
    f["volz"] = (lv-mean)/std
    crange = (f.high-f.low).replace(0, np.nan)
    body_high = f[["open","close"]].max(axis=1)
    body_low = f[["open","close"]].min(axis=1)
    f["uwick"] = (f.high-body_high)/crange
    f["lwick"] = (body_low-f.low)/crange
    f["cpos"] = (f.close-f.low)/crange
    return f


def crosses_funding(funding_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if funding_ns.size == 0:
        return False
    idx = np.searchsorted(funding_ns, entry_ns, side="left")
    return idx < funding_ns.size and funding_ns[idx] <= exit_ns


def simulate(symbol: str, frame: pd.DataFrame, funding: pd.DatetimeIndex) -> list[dict[str, object]]:
    long_sig = (frame.move3 <= -2.0) & (frame.volz >= 1.0) & (frame.lwick >= 0.5) & (frame.cpos >= 0.55) & (frame.imb1 >= -0.1)
    short_sig = (frame.move3 >= 2.0) & (frame.volz >= 1.0) & (frame.uwick >= 0.5) & (frame.cpos <= 0.45) & (frame.imb1 <= 0.1)
    strength = frame.move3.abs() + frame.volz.clip(lower=0).fillna(0)/3
    ts_ns = frame.open_time.astype("int64").to_numpy()
    first = np.searchsorted(ts_ns, START.value)
    final = np.searchsorted(ts_ns, END.value)
    candidates = np.flatnonzero((long_sig | short_sig).to_numpy() & (np.arange(len(frame)) >= first) & (np.arange(len(frame)) < final))
    o=frame.open.to_numpy(float); h=frame.high.to_numpy(float); l=frame.low.to_numpy(float); a=frame.atr.to_numpy(float); times=list(frame.open_time)
    funding_ns = funding.astype("int64").to_numpy()
    out: list[dict[str, object]] = []
    last_exit = -1
    for si in candidates:
        if si <= last_exit or si+1 >= final or not np.isfinite(a[si]):
            continue
        side = 1 if long_sig.iloc[si] else -1
        ei = si+1; scheduled = ei+3
        if scheduled >= final or times[ei].date() != times[scheduled].date():
            continue
        if crosses_funding(funding_ns, int(ts_ns[ei]), int(ts_ns[scheduled])):
            continue
        entry = o[ei]; stop = entry-side*1.5*a[si]; risk=abs(entry-stop); target=entry+side*2.0*risk
        exit_price=o[scheduled]; exit_i=scheduled; reason="time"; mae=0.0; mfe=0.0
        for bi in range(ei, scheduled):
            exc=[side*(h[bi]/entry-1)*1e4, side*(l[bi]/entry-1)*1e4]
            mae=min(mae,*exc); mfe=max(mfe,*exc)
            if side==1 and o[bi] <= stop: exit_price,exit_i,reason=o[bi],bi,"stop_gap"; break
            if side==-1 and o[bi] >= stop: exit_price,exit_i,reason=o[bi],bi,"stop_gap"; break
            if side==1 and l[bi] <= stop: exit_price,exit_i,reason=stop,bi,"stop"; break
            if side==-1 and h[bi] >= stop: exit_price,exit_i,reason=stop,bi,"stop"; break
            if side==1 and h[bi] >= target: exit_price,exit_i,reason=target,bi,"target"; break
            if side==-1 and l[bi] <= target: exit_price,exit_i,reason=target,bi,"target"; break
        gross=side*(exit_price/entry-1)*1e4
        out.append({"symbol":symbol,"setup":"FLOW_EXHAUST_45M","side":side,"signal_time":times[si],"entry_time":times[ei],"exit_time":times[exit_i],"gross_bps":gross,"net_bps":gross-BASE_COST_BPS,"strength":float(strength.iloc[si]),"reason":reason,"mae_bps":mae,"mfe_bps":mfe})
        last_exit=exit_i
    return out


def metrics(frame: pd.DataFrame, extra_cost: float = 0.0) -> dict[str, float | int]:
    if frame.empty:
        return {"trades":0,"avg_bps":None,"pf":None,"win_rate":None,"payoff":None,"total_bps":0.0}
    v=frame.net_bps.to_numpy(float)-extra_cost
    gains=v[v>0]; losses=-v[v<0]
    return {"trades":int(len(v)),"avg_bps":float(v.mean()),"pf":float(gains.sum()/losses.sum()) if losses.sum() else None,"win_rate":float(np.mean(v>0)),"payoff":float(gains.mean()/losses.mean()) if len(gains) and len(losses) else None,"total_bps":float(v.sum()),"best_bps":float(v.max()),"worst_bps":float(v.min())}


def bootstrap_days(frame: pd.DataFrame, reps: int = 30000) -> dict[str, float | None]:
    if frame.empty:
        return {"lo":None,"hi":None,"p_positive":None}
    groups=frame.assign(day=pd.to_datetime(frame.entry_time, utc=True).dt.date).groupby("day").net_bps.apply(list).tolist()
    rng=np.random.default_rng(20260727); means=np.empty(reps)
    for i in range(reps):
        values=[x for j in rng.integers(0,len(groups),len(groups)) for x in groups[j]]
        means[i]=np.mean(values) if values else np.nan
    return {"lo":float(np.nanpercentile(means,2.5)),"hi":float(np.nanpercentile(means,97.5)),"p_positive":float(np.nanmean(means>0))}


def portfolio(trades: pd.DataFrame, capital: float = 10000.0, fraction: float = 0.10, max_positions: int = 5, extra_cost: float = 0.0) -> tuple[dict[str, object], pd.DataFrame, pd.DataFrame]:
    if trades.empty:
        return {}, pd.DataFrame(), pd.DataFrame()
    t=trades.copy(); t["entry_time"]=pd.to_datetime(t.entry_time,utc=True); t["exit_time"]=pd.to_datetime(t.exit_time,utc=True)
    entries={k:g.to_dict("records") for k,g in t.groupby("entry_time")}; exits={k:g.to_dict("records") for k,g in t.groupby("exit_time")}
    equity=capital; open_pos:dict[tuple[str,pd.Timestamp],float]={}; accepted=[]; curve=[]
    for ts in sorted(set(entries)|set(exits)):
        for tr in exits.get(ts,[]):
            key=(tr["symbol"],tr["entry_time"])
            if key in open_pos:
                notional=open_pos.pop(key); pnl=notional*(float(tr["net_bps"])-extra_cost)/1e4; equity+=pnl
                accepted.append(tr|{"notional":notional,"pnl_usd":pnl,"equity_after":equity})
        for tr in sorted(entries.get(ts,[]),key=lambda x:float(x["strength"]),reverse=True):
            if len(open_pos)>=max_positions or any(k[0]==tr["symbol"] for k in open_pos):
                continue
            open_pos[(tr["symbol"],tr["entry_time"])]=equity*fraction
        curve.append({"time":ts,"equity":equity,"open_positions":len(open_pos)})
    cf=pd.DataFrame(curve); tf=pd.DataFrame(accepted); dd=cf.equity/cf.equity.cummax()-1; days=(END-START).days; ret=equity/capital-1
    result={"start_usd":capital,"end_usd":equity,"pnl_usd":equity-capital,"return_pct":ret*100,"mechanical_annualized_pct":((equity/capital)**(365/days)-1)*100,"closed_dd_pct":-dd.min()*100,"trades":len(tf),"trades_per_day":len(tf)/days,"max_positions":max_positions,"notional_per_position_pct":fraction*100,"round_turn_cost_bps":BASE_COST_BPS+extra_cost}
    return result,tf,cf


def main() -> None:
    parser=argparse.ArgumentParser(); parser.add_argument("--output",required=True); parser.add_argument("--cache",required=True); args=parser.parse_args()
    output=Path(args.output); cache=Path(args.cache); output.mkdir(parents=True,exist_ok=True); cache.mkdir(parents=True,exist_ok=True)
    manifest=[]; all_trades=[]; coverage=[]
    for symbol in SYMBOLS:
        raw, items=load_symbol(symbol,cache); manifest.extend(items); funding=fetch_funding(symbol,output)
        coverage.append({"symbol":symbol,"rows":len(raw),"first":None if raw.empty else raw.open_time.iloc[0],"last":None if raw.empty else raw.open_time.iloc[-1],"funding_events":len(funding)})
        if not raw.empty:
            f=build(raw); all_trades.extend(simulate(symbol,f,funding))
        print(symbol,len(raw),"trades",sum(1 for x in all_trades if x["symbol"]==symbol))
    pd.DataFrame(manifest).to_csv(output/"SOURCE_MANIFEST.csv",index=False); pd.DataFrame(coverage).to_csv(output/"COVERAGE.csv",index=False)
    trades=pd.DataFrame(all_trades); trades.to_csv(output/"TRADES_JULY_2026.csv",index=False)
    rows=[]
    for symbol in SYMBOLS:
        sub=trades[trades.symbol==symbol] if not trades.empty else pd.DataFrame()
        row={"symbol":symbol}|metrics(sub)|{"avg_bps_at_20bps":metrics(sub,8.0).get("avg_bps")}|bootstrap_days(sub)
        rows.append(row)
    ranking=pd.DataFrame(rows).sort_values("avg_bps",ascending=False,na_position="last"); ranking.to_csv(output/"FORWARD_RANKING_JULY_2026.csv",index=False)
    base,pt,pc=portfolio(trades); stress,_,_=portfolio(trades,extra_cost=8.0); pt.to_csv(output/"PORTFOLIO_TRADES.csv",index=False); pc.to_csv(output/"PORTFOLIO_EQUITY.csv",index=False)
    summary={"generated_at":datetime.now(UTC).isoformat(),"period":{"start":str(START),"end_exclusive":str(END)},"symbols":SYMBOLS,"aggregate":metrics(trades),"aggregate_stress_20bps":metrics(trades,8.0),"bootstrap":bootstrap_days(trades),"portfolio":{"base_12bps":base,"stress_20bps":stress}}
    (output/"SUMMARY.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    report=f"""# Round 16 — fresh July 2026 forward check\n\nExact six Round 15 candidates, unchanged FLOW_EXHAUST_45M rule. Daily official USD-M 15m archives through 2026-07-26, checksum verified. Funding endpoint is attempted first; if blocked by hosted CI, every standard 00:00/08:00/16:00 UTC boundary is excluded conservatively.\n\n## Ranking\n\n{ranking.to_markdown(index=False,floatfmt='.2f')}\n\n## Aggregate and portfolio\n\n```json\n{json.dumps(summary,indent=2)}\n```\n\nThe period is only 26 days; mechanical annualization is not a forecast. Closed-equity DD is not intratrade MTM DD.\n"""
    (output/"REPORT_RU.md").write_text(report,encoding="utf-8")
    checks=[]
    for p in sorted(output.rglob("*")):
        if p.is_file() and p.name!="SHA256SUMS.txt": checks.append(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(output)}")
    (output/"SHA256SUMS.txt").write_text("\n".join(checks)+"\n",encoding="utf-8")
    print(json.dumps(summary,indent=2))

if __name__=="__main__": main()
