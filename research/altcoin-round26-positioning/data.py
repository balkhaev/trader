from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from config import (
    FUNDING_MONTHLY,
    INTERVAL,
    JULY_END,
    KLINE_DAILY,
    KLINE_MONTHLY,
    METRICS_DAILY,
    PRE_JULY_END,
    WARMUP_START,
)

KLINE_COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]
METRIC_COLS = [
    "create_time", "symbol", "sum_open_interest", "sum_open_interest_value",
    "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio",
    "count_long_short_ratio", "sum_taker_long_short_vol_ratio",
]


def _get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": "altcoin-positioning-round26/1"},
            )
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_verified(task: tuple[str, str, str, str, Path]) -> dict[str, object]:
    symbol, period, kind, url, path = task
    path.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, object] = {
        "symbol": symbol,
        "period": period,
        "kind": kind,
        "url": url,
        "path": str(path),
    }
    try:
        checksum = _get(url + ".CHECKSUM", 60)
        if checksum.status_code == 404:
            return meta | {"status": "missing"}
        expected = checksum.text.strip().split()[0].lower()
        if path.exists() and _sha(path) == expected:
            return meta | {
                "status": "cached_verified",
                "sha256": expected,
                "bytes": path.stat().st_size,
            }
        response = _get(url, 180)
        if response.status_code == 404:
            return meta | {"status": "missing"}
        actual = hashlib.sha256(response.content).hexdigest()
        if actual != expected:
            raise RuntimeError(f"checksum {actual} != {expected}")
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_bytes(response.content)
        temp.replace(path)
        return meta | {
            "status": "downloaded_verified",
            "sha256": actual,
            "bytes": len(response.content),
        }
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}


def tasks(symbols: list[str], cache: Path) -> list[tuple[str, str, str, str, Path]]:
    output: list[tuple[str, str, str, str, Path]] = []
    months = pd.period_range(
        WARMUP_START.tz_localize(None),
        (PRE_JULY_END - pd.Timedelta(days=1)).tz_localize(None),
        freq="M",
    )
    for symbol in symbols:
        for period in months:
            month = period.strftime("%Y-%m")
            name = f"{symbol}-{INTERVAL}-{month}.zip"
            output.append((
                symbol,
                month,
                "kline_monthly",
                f"{KLINE_MONTHLY}/{symbol}/{INTERVAL}/{name}",
                cache / "kline_monthly" / symbol / name,
            ))
            fname = f"{symbol}-fundingRate-{month}.zip"
            output.append((
                symbol,
                month,
                "funding_monthly",
                f"{FUNDING_MONTHLY}/{symbol}/{fname}",
                cache / "funding_monthly" / symbol / fname,
            ))
        for day in pd.date_range(PRE_JULY_END, JULY_END - pd.Timedelta(days=1), freq="1D"):
            date = day.strftime("%Y-%m-%d")
            name = f"{symbol}-{INTERVAL}-{date}.zip"
            output.append((
                symbol,
                date,
                "kline_daily",
                f"{KLINE_DAILY}/{symbol}/{INTERVAL}/{name}",
                cache / "kline_daily" / symbol / name,
            ))
        for day in pd.date_range(WARMUP_START, JULY_END - pd.Timedelta(days=1), freq="1D"):
            date = day.strftime("%Y-%m-%d")
            name = f"{symbol}-metrics-{date}.zip"
            output.append((
                symbol,
                date,
                "metrics_daily",
                f"{METRICS_DAILY}/{symbol}/{name}",
                cache / "metrics_daily" / symbol / name,
            ))
    return output


def download_all(symbols: list[str], cache: Path, workers: int) -> list[dict[str, object]]:
    work = tasks(symbols, cache)
    result: list[dict[str, object]] = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch_verified, work), 1):
            result.append(item)
            if index % 250 == 0:
                print(f"archives {index}/{len(work)}", flush=True)
    return result


def verified_paths(
    symbol: str,
    manifest: list[dict[str, object]],
    kinds: set[str],
) -> list[Path]:
    return sorted(
        Path(str(item["path"]))
        for item in manifest
        if item["symbol"] == symbol
        and item["kind"] in kinds
        and item["status"] in {"cached_verified", "downloaded_verified"}
    )


def read_first_member(path: Path) -> bytes:
    with zipfile.ZipFile(path) as bundle:
        names = [name for name in bundle.namelist() if not name.endswith("/")]
        if not names:
            return b""
        return bundle.read(names[0])


def parse_time(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    median = numeric.dropna().median()
    if pd.isna(median):
        return pd.to_datetime(numeric, utc=True, errors="coerce")
    if median > 1e14:
        unit = "us"
    elif median > 1e11:
        unit = "ms"
    else:
        unit = "s"
    return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")


def read_kline(path: Path) -> pd.DataFrame:
    raw = read_first_member(path)
    if not raw:
        return pd.DataFrame(columns=KLINE_COLS)
    frame = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False).iloc[:, :12]
    frame.columns = KLINE_COLS
    frame["open_time"] = parse_time(frame.open_time)
    for column in KLINE_COLS[1:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna(subset=["open_time", "open", "high", "low", "close", "volume"])


def read_metrics(path: Path) -> pd.DataFrame:
    raw = read_first_member(path)
    if not raw:
        return pd.DataFrame(columns=METRIC_COLS)
    first = pd.read_csv(io.BytesIO(raw), low_memory=False)
    normalized = {str(c).strip().lower(): c for c in first.columns}
    if "create_time" not in normalized:
        first = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
        first = first.iloc[:, : len(METRIC_COLS)]
        first.columns = METRIC_COLS[: first.shape[1]]
    else:
        first = first.rename(columns={v: k for k, v in normalized.items()})
    for column in METRIC_COLS:
        if column not in first:
            first[column] = np.nan
    first = first[METRIC_COLS]
    first["create_time"] = parse_time(first.create_time)
    for column in METRIC_COLS[2:]:
        first[column] = pd.to_numeric(first[column], errors="coerce")
    return first.dropna(subset=["create_time", "sum_open_interest_value"])


def load_klines(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
    parts = [
        read_kline(path)
        for path in verified_paths(symbol, manifest, {"kline_monthly", "kline_daily"})
    ]
    if not parts:
        return pd.DataFrame(columns=KLINE_COLS)
    frame = pd.concat(parts, ignore_index=True)
    return (
        frame[(frame.open_time >= WARMUP_START) & (frame.open_time < JULY_END)]
        .sort_values("open_time")
        .drop_duplicates("open_time")
        .reset_index(drop=True)
    )


def load_metrics(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
    parts = [
        read_metrics(path)
        for path in verified_paths(symbol, manifest, {"metrics_daily"})
    ]
    if not parts:
        return pd.DataFrame(columns=METRIC_COLS)
    frame = pd.concat(parts, ignore_index=True)
    return (
        frame[(frame.create_time >= WARMUP_START) & (frame.create_time < JULY_END)]
        .sort_values("create_time")
        .drop_duplicates("create_time")
        .reset_index(drop=True)
    )


def load_funding(symbol: str, manifest: list[dict[str, object]]) -> pd.DatetimeIndex:
    values: list[int] = []
    for path in verified_paths(symbol, manifest, {"funding_monthly"}):
        raw = read_first_member(path)
        if not raw:
            continue
        table = pd.read_csv(io.BytesIO(raw), low_memory=False)
        if "calc_time" in table.columns:
            data = pd.to_numeric(table.calc_time, errors="coerce")
        else:
            table = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
            data = pd.to_numeric(table.iloc[:, 0], errors="coerce")
        data = data.dropna()
        if len(data):
            median = data.median()
            if median > 1e14:
                data = data / 1000
            values.extend(data.astype("int64").tolist())
    # Conservative July fallback: positions touching standard funding boundaries are skipped.
    july = pd.date_range(PRE_JULY_END, JULY_END, freq="8h", tz="UTC")
    historical = (
        pd.to_datetime(pd.Series(values, dtype="int64"), unit="ms", utc=True)
        if values else pd.Series([], dtype="datetime64[ns, UTC]")
    )
    combined = pd.DatetimeIndex(list(historical) + list(july))
    return combined[(combined >= WARMUP_START) & (combined < JULY_END)].drop_duplicates().sort_values()
