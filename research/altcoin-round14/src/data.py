from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

from config import END, EXCHANGE_INFO_HOSTS, FUNDING_BASE, INTERVAL, KLINE_BASE, START

COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


def months() -> list[str]:
    start = START.tz_localize(None)
    end = (END - pd.Timedelta(days=1)).tz_localize(None)
    return [x.strftime("%Y-%m") for x in pd.period_range(start, end, freq="M")]


def _get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(4):
        try:
            response = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": "altcoin-round14/2"},
            )
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:  # pragma: no cover - exercised by network retries
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _archive_spec(symbol: str, month: str, kind: str) -> tuple[str, str]:
    if kind == "kline":
        name = f"{symbol}-{INTERVAL}-{month}.zip"
        return name, f"{KLINE_BASE}/{symbol}/{INTERVAL}/{name}"
    if kind == "funding":
        name = f"{symbol}-fundingRate-{month}.zip"
        return name, f"{FUNDING_BASE}/{symbol}/{name}"
    raise ValueError(f"unknown archive kind: {kind}")


def fetch_one(task: tuple[str, str, str, Path]) -> dict[str, object]:
    symbol, month, kind, root = task
    name, url = _archive_spec(symbol, month, kind)
    checksum_url = url + ".CHECKSUM"
    path = root / kind / symbol / name
    path.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, object] = {
        "symbol": symbol,
        "month": month,
        "kind": kind,
        "url": url,
        "checksum_url": checksum_url,
        "path": str(path),
    }
    try:
        checksum_response = _get(checksum_url, 60)
        if checksum_response.status_code == 404:
            return meta | {"status": "missing"}
        expected = checksum_response.text.strip().split()[0].lower()
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
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(response.content)
        tmp.replace(path)
        return meta | {
            "status": "downloaded_verified",
            "sha256": actual,
            "bytes": len(response.content),
        }
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}


def download_all(symbols: list[str], root: Path, workers: int = 12) -> list[dict[str, object]]:
    tasks = [
        (symbol, month, kind, root)
        for symbol in symbols
        for month in months()
        for kind in ("kline", "funding")
    ]
    output: list[dict[str, object]] = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch_one, tasks), 1):
            output.append(item)
            if index % 100 == 0:
                print(f"archives {index}/{len(tasks)}")
    return output


def read_kline_zip(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as bundle:
        names = [name for name in bundle.namelist() if not name.endswith("/")]
        if not names:
            return pd.DataFrame(columns=COLS)
        raw = bundle.read(names[0])
    frame = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False).iloc[:, :12]
    frame.columns = COLS
    for column in COLS[:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["open_time", "open", "high", "low", "close", "volume"])
    # Binance public archives moved from milliseconds to microseconds in 2025.
    if len(frame) and frame.open_time.median() > 1e14:
        frame.open_time /= 1000
    frame.open_time = pd.to_datetime(frame.open_time.astype("int64"), unit="ms", utc=True)
    return frame


def _verified_paths(symbol: str, manifest: list[dict[str, object]], kind: str) -> list[Path]:
    return [
        Path(str(item["path"]))
        for item in manifest
        if item["symbol"] == symbol
        and item["kind"] == kind
        and item["status"] in {"cached_verified", "downloaded_verified"}
    ]


def load_symbol(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
    parts: list[pd.DataFrame] = []
    for path in sorted(_verified_paths(symbol, manifest, "kline")):
        try:
            parts.append(read_kline_zip(path))
        except Exception as exc:
            print("parse warning", path, exc)
    if not parts:
        return pd.DataFrame(columns=COLS)
    frame = pd.concat(parts, ignore_index=True)
    frame = (
        frame[(frame.open_time >= START) & (frame.open_time < END)]
        .sort_values("open_time")
        .drop_duplicates("open_time")
        .reset_index(drop=True)
    )
    return frame


def load_funding_events(symbol: str, manifest: list[dict[str, object]]) -> pd.DatetimeIndex:
    timestamps: list[int] = []
    for path in sorted(_verified_paths(symbol, manifest, "funding")):
        try:
            with zipfile.ZipFile(path) as bundle:
                names = [name for name in bundle.namelist() if not name.endswith("/")]
                if not names:
                    continue
                raw = bundle.read(names[0])
            table = pd.read_csv(io.BytesIO(raw), low_memory=False)
            if "calc_time" in table.columns:
                values = pd.to_numeric(table["calc_time"], errors="coerce")
            else:
                table2 = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
                values = pd.to_numeric(table2.iloc[:, 0], errors="coerce")
            values = values.dropna().astype("int64")
            if len(values) and values.median() > 1e14:
                values //= 1000
            timestamps.extend(values.tolist())
        except Exception as exc:
            print("funding parse warning", path, exc)
    if not timestamps:
        return pd.DatetimeIndex([], tz="UTC")
    index = pd.to_datetime(pd.Series(timestamps, dtype="int64"), unit="ms", utc=True)
    index = index[(index >= START) & (index < END)]
    return pd.DatetimeIndex(index.drop_duplicates().sort_values())


def active_symbols() -> dict[str, bool]:
    for host in EXCHANGE_INFO_HOSTS:
        try:
            data = _get(host, 60).json()
            return {
                item["symbol"]: (
                    item.get("status") == "TRADING"
                    and item.get("contractType") == "PERPETUAL"
                )
                for item in data.get("symbols", [])
            }
        except Exception as exc:
            print("exchangeInfo warning", host, exc)
    return {}
