from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import json
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from config import (
    FUNDING_ENDPOINTS,
    FUNDING_MONTHLY,
    INTERVAL,
    JULY_END,
    KLINE_DAILY,
    KLINE_MONTHLY,
    PREMIUM_DAILY,
    PREMIUM_MONTHLY,
    PRE_JULY_END,
    WARMUP_START,
)

COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


def get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": "altcoin-premium-round27/1"},
            )
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def sha(path: Path) -> str:
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
        checksum = get(url + ".CHECKSUM", 60)
        if checksum.status_code == 404:
            return meta | {"status": "missing"}
        expected = checksum.text.strip().split()[0].lower()
        if path.exists() and sha(path) == expected:
            return meta | {"status": "cached_verified", "sha256": expected, "bytes": path.stat().st_size}
        response = get(url, 180)
        if response.status_code == 404:
            return meta | {"status": "missing"}
        actual = hashlib.sha256(response.content).hexdigest()
        if actual != expected:
            raise RuntimeError(f"checksum {actual} != {expected}")
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_bytes(response.content)
        temp.replace(path)
        return meta | {"status": "downloaded_verified", "sha256": actual, "bytes": len(response.content)}
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}


def build_tasks(symbols: list[str], cache: Path) -> list[tuple[str, str, str, str, Path]]:
    tasks: list[tuple[str, str, str, str, Path]] = []
    months = pd.period_range(
        WARMUP_START.tz_localize(None),
        (PRE_JULY_END - pd.Timedelta(days=1)).tz_localize(None),
        freq="M",
    )
    for symbol in symbols:
        for period in months:
            month = period.strftime("%Y-%m")
            for kind, base, prefix in [
                ("kline_monthly", KLINE_MONTHLY, symbol),
                ("premium_monthly", PREMIUM_MONTHLY, symbol),
            ]:
                name = f"{prefix}-{INTERVAL}-{month}.zip"
                tasks.append((
                    symbol,
                    month,
                    kind,
                    f"{base}/{symbol}/{INTERVAL}/{name}",
                    cache / kind / symbol / name,
                ))
            name = f"{symbol}-fundingRate-{month}.zip"
            tasks.append((
                symbol,
                month,
                "funding_monthly",
                f"{FUNDING_MONTHLY}/{symbol}/{name}",
                cache / "funding_monthly" / symbol / name,
            ))
        for day in pd.date_range(PRE_JULY_END, JULY_END - pd.Timedelta(days=1), freq="1D"):
            date = day.strftime("%Y-%m-%d")
            for kind, base in [
                ("kline_daily", KLINE_DAILY),
                ("premium_daily", PREMIUM_DAILY),
            ]:
                name = f"{symbol}-{INTERVAL}-{date}.zip"
                tasks.append((
                    symbol,
                    date,
                    kind,
                    f"{base}/{symbol}/{INTERVAL}/{name}",
                    cache / kind / symbol / name,
                ))
    return tasks


def download_all(symbols: list[str], cache: Path, workers: int) -> list[dict[str, object]]:
    tasks = build_tasks(symbols, cache)
    output: list[dict[str, object]] = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch_verified, tasks), 1):
            output.append(item)
            if index % 100 == 0:
                print(f"archives {index}/{len(tasks)}", flush=True)
    return output


def verified_paths(symbol: str, manifest: list[dict[str, object]], kinds: set[str]) -> list[Path]:
    return sorted(
        Path(str(item["path"]))
        for item in manifest
        if item["symbol"] == symbol
        and item["kind"] in kinds
        and item["status"] in {"cached_verified", "downloaded_verified"}
    )


def first_member(path: Path) -> bytes:
    with zipfile.ZipFile(path) as bundle:
        names = [name for name in bundle.namelist() if not name.endswith("/")]
        return bundle.read(names[0]) if names else b""


def parse_time(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    median = numeric.dropna().median()
    if pd.isna(median):
        return pd.to_datetime(numeric, utc=True, errors="coerce")
    unit = "us" if median > 1e14 else ("ms" if median > 1e11 else "s")
    return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")


def read_kline(path: Path) -> pd.DataFrame:
    raw = first_member(path)
    if not raw:
        return pd.DataFrame(columns=COLS)
    frame = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False).iloc[:, :12]
    frame.columns = COLS
    frame.open_time = parse_time(frame.open_time)
    for column in COLS[1:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna(subset=["open_time", "open", "high", "low", "close"])


def load_series(symbol: str, manifest: list[dict[str, object]], premium: bool) -> pd.DataFrame:
    kinds = {"premium_monthly", "premium_daily"} if premium else {"kline_monthly", "kline_daily"}
    parts = [read_kline(path) for path in verified_paths(symbol, manifest, kinds)]
    if not parts:
        return pd.DataFrame(columns=COLS)
    frame = pd.concat(parts, ignore_index=True)
    return (
        frame[(frame.open_time >= WARMUP_START) & (frame.open_time < JULY_END)]
        .sort_values("open_time")
        .drop_duplicates("open_time")
        .reset_index(drop=True)
    )


def read_funding_zip(path: Path) -> pd.DataFrame:
    raw = first_member(path)
    if not raw:
        return pd.DataFrame(columns=["funding_time", "funding_rate"])
    table = pd.read_csv(io.BytesIO(raw), low_memory=False)
    if "calc_time" in table.columns:
        timestamp = table.calc_time
        rate = table.last_funding_rate if "last_funding_rate" in table else table.iloc[:, -1]
    else:
        table = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
        timestamp = table.iloc[:, 0]
        rate = table.iloc[:, -1]
    return pd.DataFrame({
        "funding_time": parse_time(timestamp),
        "funding_rate": pd.to_numeric(rate, errors="coerce"),
    }).dropna()


def july_funding(symbol: str, output: Path) -> pd.DataFrame:
    start_ms = int(PRE_JULY_END.timestamp() * 1000)
    end_ms = int(JULY_END.timestamp() * 1000)
    for host in FUNDING_ENDPOINTS:
        try:
            response = get(
                host + f"?symbol={symbol}&startTime={start_ms}&endTime={end_ms}&limit=1000",
                60,
            )
            data = response.json()
            if isinstance(data, list):
                (output / f"{symbol}_JULY_FUNDING_RAW.json").write_text(
                    json.dumps({"url": response.url, "data": data}, indent=2)
                )
                return pd.DataFrame({
                    "funding_time": pd.to_datetime(
                        pd.Series([int(item["fundingTime"]) for item in data], dtype="int64"),
                        unit="ms",
                        utc=True,
                    ),
                    "funding_rate": pd.to_numeric(
                        pd.Series([item.get("fundingRate") for item in data]), errors="coerce"
                    ),
                }).dropna()
        except Exception:
            continue
    # Conservative fallback with unknown rates set to zero; time-crossing filter remains active.
    index = pd.date_range(PRE_JULY_END, JULY_END, freq="8h", tz="UTC")
    return pd.DataFrame({"funding_time": index, "funding_rate": 0.0})


def load_funding(
    symbol: str,
    manifest: list[dict[str, object]],
    output: Path,
) -> pd.DataFrame:
    parts = [read_funding_zip(path) for path in verified_paths(symbol, manifest, {"funding_monthly"})]
    parts.append(july_funding(symbol, output))
    frame = pd.concat(parts, ignore_index=True) if parts else july_funding(symbol, output)
    return (
        frame[(frame.funding_time >= WARMUP_START) & (frame.funding_time < JULY_END)]
        .sort_values("funding_time")
        .drop_duplicates("funding_time")
        .reset_index(drop=True)
    )
