from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parents[1] / "altcoin-round28-confluence" / "run.py"
spec = importlib.util.spec_from_file_location("round28_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round28 base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

# Fixed before this run. BTC and ETH are excluded from candidate trading.
SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT",
    "LINKUSDT", "DOTUSDT", "LTCUSDT", "ETCUSDT", "NEARUSDT",
    "ATOMUSDT", "APTUSDT", "OPUSDT", "SUIUSDT", "INJUSDT",
    "AAVEUSDT", "UNIUSDT", "FILUSDT", "WLDUSDT", "TIAUSDT",
]
START = pd.Timestamp("2025-07-01", tz="UTC")
CUT = pd.Timestamp("2026-01-01", tz="UTC")
PRE_JULY_END = pd.Timestamp("2026-07-01", tz="UTC")
JULY_END = pd.Timestamp("2026-07-27", tz="UTC")
WARMUP_START = pd.Timestamp("2025-06-01", tz="UTC")
BASE_COST = 12.0
STRESS_COST = 20.0

base.SYMBOLS = SYMBOLS
base.START = START
base.CUT = CUT
base.PRE_JULY_END = PRE_JULY_END
base.JULY_END = JULY_END
base.WARMUP_START = WARMUP_START
base.BASE_COST = BASE_COST
base.STRESS_COST = STRESS_COST


@dataclass(frozen=True)
class Config:
    name: str
    side_mode: str
    move_threshold: float
    oi_threshold: float
    flow_threshold: float
    volume_threshold: float
    hold_bars: int
    stop_atr: float
    target_r: float | None


def configs() -> list[Config]:
    result: list[Config] = []
    # Compact, causal grid. The economic hypothesis is position building in the
    # direction of an already established impulse, not a generic indicator scan.
    for side_mode in ("both", "long", "short"):
        for move in (1.25, 1.75, 2.25):
            for oi in (0.75, 1.25):
                for hold in (8, 16, 32):  # 2h, 4h, 8h on 15m bars
                    result.append(
                        Config(
                            name=f"{side_mode.upper()}_M{move:g}_OI{oi:g}_H{hold*15}",
                            side_mode=side_mode,
                            move_threshold=move,
                            oi_threshold=oi,
                            flow_threshold=0.10,
                            volume_threshold=0.0,
                            hold_bars=hold,
                            stop_atr=2.0,
                            target_r=None,
                        )
                    )
    # A smaller stricter sub-grid checks whether volume confirmation and a
    # convex target improve transfer without exploding the search space.
    for side_mode in ("both", "long", "short"):
        for hold in (8, 16, 32):
            result.append(
                Config(
                    name=f"{side_mode.upper()}_STRICT_H{hold*15}_T4",
                    side_mode=side_mode,
                    move_threshold=1.75,
                    oi_threshold=1.25,
                    flow_threshold=0.15,
                    volume_threshold=0.75,
                    hold_bars=hold,
                    stop_atr=1.75,
                    target_r=4.0,
                )
            )
    return result


def resolve_column(frame: pd.DataFrame, preferred: list[str], tokens: list[str]) -> str:
    for name in preferred:
        if name in frame.columns:
            return name
    candidates = [
        str(column)
        for column in frame.columns
        if all(token.lower() in str(column).lower() for token in tokens)
    ]
    if not candidates:
        raise KeyError(
            f"missing feature column; preferred={preferred}, tokens={tokens}, "
            f"available={list(frame.columns)}"
        )
    return candidates[0]


def feature_columns(frame: pd.DataFrame) -> dict[str, str]:
    return {
        "move": resolve_column(frame, ["move3", "move_3", "move45"], ["move", "3"]),
        "oi": resolve_column(frame, ["oi_z", "oi_change_z", "oiz"], ["oi", "z"]),
        "flow": resolve_column(frame, ["imb3", "imbalance3", "taker_imb3"], ["imb", "3"]),
        "volume": resolve_column(frame, ["volz", "volume_z", "quote_volume_z"], ["vol", "z"]),
    }


def crosses_funding(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if len(events_ns) == 0:
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def simulate(
    symbol: str,
    frame: pd.DataFrame,
    funding: pd.DatetimeIndex,
    cfg: Config,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame()
    columns = feature_columns(frame)
    move = pd.to_numeric(frame[columns["move"]], errors="coerce")
    oi_z = pd.to_numeric(frame[columns["oi"]], errors="coerce")
    flow = pd.to_numeric(frame[columns["flow"]], errors="coerce")
    volume_z = pd.to_numeric(frame[columns["volume"]], errors="coerce")

    long_signal = (
        (move >= cfg.move_threshold)
        & (oi_z >= cfg.oi_threshold)
        & (flow >= cfg.flow_threshold)
        & (volume_z >= cfg.volume_threshold)
    )
    short_signal = (
        (move <= -cfg.move_threshold)
        & (oi_z >= cfg.oi_threshold)
        & (flow <= -cfg.flow_threshold)
        & (volume_z >= cfg.volume_threshold)
    )
    if cfg.side_mode == "long":
        short_signal[:] = False
    elif cfg.side_mode == "short":
        long_signal[:] = False

    timestamps = list(pd.to_datetime(frame.open_time, utc=True))
    timestamp_ns = pd.to_datetime(frame.open_time, utc=True).astype("int64").to_numpy()
    open_price = pd.to_numeric(frame.open, errors="coerce").to_numpy(float)
    high = pd.to_numeric(frame.high, errors="coerce").to_numpy(float)
    low = pd.to_numeric(frame.low, errors="coerce").to_numpy(float)
    atr = pd.to_numeric(frame.atr, errors="coerce").to_numpy(float)
    funding_ns = funding.astype("int64").to_numpy()
    first = int(np.searchsorted(timestamp_ns, start.value))
    final = int(np.searchsorted(timestamp_ns, end.value))
    candidate_indexes = np.flatnonzero(
        (long_signal.fillna(False).to_numpy() | short_signal.fillna(False).to_numpy())
        & (np.arange(len(frame)) >= first)
        & (np.arange(len(frame)) < final)
    )

    records: list[dict[str, object]] = []
    last_exit = -1
    for signal_index in candidate_indexes:
        if signal_index <= last_exit:
            continue
        entry_index = signal_index + 1
        scheduled_exit = entry_index + cfg.hold_bars
        if entry_index >= final or scheduled_exit >= final:
            continue
        if not np.isfinite(atr[signal_index]) or atr[signal_index] <= 0:
            continue
        # Contiguous 15m data and strict intraday holding.
        if timestamps[scheduled_exit] - timestamps[entry_index] != pd.Timedelta(minutes=15 * cfg.hold_bars):
            continue
        if timestamps[entry_index].date() != timestamps[scheduled_exit].date():
            continue
        if crosses_funding(
            funding_ns,
            int(timestamp_ns[entry_index]),
            int(timestamp_ns[scheduled_exit]),
        ):
            continue

        side = 1 if bool(long_signal.iloc[signal_index]) else -1
        entry = open_price[entry_index]
        if not np.isfinite(entry) or entry <= 0:
            continue
        stop = entry - side * cfg.stop_atr * atr[signal_index]
        risk = abs(entry - stop)
        target = None if cfg.target_r is None else entry + side * cfg.target_r * risk
        exit_index = scheduled_exit
        exit_price = open_price[scheduled_exit]
        reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0

        for bar_index in range(entry_index, scheduled_exit):
            excursions = [
                side * (high[bar_index] / entry - 1) * 1e4,
                side * (low[bar_index] / entry - 1) * 1e4,
            ]
            mae_bps = min(mae_bps, *excursions)
            mfe_bps = max(mfe_bps, *excursions)
            if side == 1 and open_price[bar_index] <= stop:
                exit_index, exit_price, reason = bar_index, open_price[bar_index], "stop_gap"
                break
            if side == -1 and open_price[bar_index] >= stop:
                exit_index, exit_price, reason = bar_index, open_price[bar_index], "stop_gap"
                break
            if side == 1 and low[bar_index] <= stop:
                exit_index, exit_price, reason = bar_index, stop, "stop"
                break
            if side == -1 and high[bar_index] >= stop:
                exit_index, exit_price, reason = bar_index, stop, "stop"
                break
            if target is not None and side == 1 and high[bar_index] >= target:
                exit_index, exit_price, reason = bar_index, target, "target"
                break
            if target is not None and side == -1 and low[bar_index] <= target:
                exit_index, exit_price, reason = bar_index, target, "target"
                break

        gross_bps = side * (exit_price / entry - 1) * 1e4
        records.append(
            {
                "config": cfg.name,
                "symbol": symbol,
                "side": side,
                "signal_time": timestamps[signal_index],
                "entry_time": timestamps[entry_index],
                "exit_time": timestamps[exit_index],
                "gross_bps": gross_bps,
                "net12_bps": gross_bps - BASE_COST,
                "net20_bps": gross_bps - STRESS_COST,
                "stop_distance_bps": abs(entry - stop) / entry * 1e4,
                "move_atr": float(move.iloc[signal_index]),
                "oi_z": float(oi_z.iloc[signal_index]),
                "flow": float(flow.iloc[signal_index]),
                "volume_z": float(volume_z.iloc[signal_index]),
                "mae_bps": mae_bps,
                "mfe_bps": mfe_bps,
                "reason": reason,
                "strength": float(abs(move.iloc[signal_index]) + max(oi_z.iloc[signal_index], 0) / 2),
            }
        )
        last_exit = exit_index
    return pd.DataFrame(records)


def metrics(frame: pd.DataFrame, cost: float = STRESS_COST) -> dict[str, float | int]:
    if frame.empty:
        return {
            "trades": 0,
            "avg_bps": np.nan,
            "pf": np.nan,
            "win_rate": np.nan,
            "total_bps": 0.0,
            "breadth": np.nan,
        }
    values = frame.gross_bps.to_numpy(float) - cost
    gains = values[values > 0]
    losses = -values[values < 0]
    symbol_means = frame.assign(adjusted=values).groupby("symbol").adjusted.mean()
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "total_bps": float(values.sum()),
        "breadth": float(np.mean(symbol_means > 0)) if len(symbol_means) else np.nan,
        "symbols": int(frame.symbol.nunique()),
    }


def selection_score(a: dict[str, float | int], b: dict[str, float | int]) -> float:
    eligible = (
        a["trades"] >= 80
        and b["trades"] >= 80
        and a["avg_bps"] > 0
        and b["avg_bps"] > 0
        and a["pf"] > 1.10
        and b["pf"] > 1.10
        and a["breadth"] >= 0.50
        and b["breadth"] >= 0.50
    )
    if not eligible:
        return -1e9
    return (
        min(float(a["avg_bps"]), float(b["avg_bps"]))
        * math.sqrt(min(float(a["trades"]), float(b["trades"])) / 100)
        * min(float(a["pf"]), float(b["pf"]), 3)
        * (0.5 + min(float(a["breadth"]), float(b["breadth"])))
    )


def account(
    frame: pd.DataFrame,
    risk_pct: float,
    cost: float,
    capital: float = 10_000.0,
    max_positions: int = 4,
    gross_cap: float = 4.0,
) -> dict[str, float | int]:
    if frame.empty:
        return {}
    data = frame.sort_values(["entry_time", "strength"], ascending=[True, False]).reset_index(drop=True)
    equity = capital
    open_positions: dict[int, dict[str, float | str]] = {}
    accepted = 0
    curve: list[float] = []
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)):
        for idx, position in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += float(position["notional"]) * (float(row.gross_bps) - cost) / 1e4
                del open_positions[idx]
                accepted += 1
        for idx in data.index[data.entry_time == timestamp]:
            row = data.iloc[idx]
            if len(open_positions) >= max_positions:
                continue
            if any(str(position["symbol"]) == row.symbol for position in open_positions.values()):
                continue
            distance = (float(row.stop_distance_bps) + cost) / 1e4
            target_risk = risk_pct / 100
            notional = min(equity * target_risk / distance, equity * 1.5)
            remaining = max(0.0, equity * gross_cap - sum(float(p["notional"]) for p in open_positions.values()))
            notional = min(notional, remaining)
            if notional <= 0:
                continue
            open_positions[idx] = {"symbol": row.symbol, "notional": notional}
        for idx, position in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += float(position["notional"]) * (float(row.gross_bps) - cost) / 1e4
                del open_positions[idx]
                accepted += 1
        curve.append(equity)
    curve_array = np.asarray(curve)
    drawdown = curve_array / np.maximum.accumulate(curve_array) - 1
    days = max(1, int((pd.to_datetime(data.entry_time).max() - pd.to_datetime(data.entry_time).min()).days) + 1)
    return {
        "risk_pct": risk_pct,
        "start_usd": capital,
        "end_usd": float(equity),
        "pnl_usd": float(equity - capital),
        "return_pct": float((equity / capital - 1) * 100),
        "mechanical_annualized_pct": float(((equity / capital) ** (365 / days) - 1) * 100),
        "closed_dd_pct": float(-drawdown.min() * 100),
        "accepted_trades": int(accepted),
        "cost_bps": cost,
        "max_positions": max_positions,
        "gross_cap_x": gross_cap,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = base.download_all(cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    frames: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        kline = base.load_concat(symbol, manifest, {"kline_monthly", "kline_daily"}, base.read_kline)
        premium = base.load_concat(symbol, manifest, {"premium_monthly", "premium_daily"}, base.read_kline)
        metric = base.load_concat(symbol, manifest, {"metrics_daily"}, base.read_metrics)
        funding_events = base.load_funding(symbol, manifest)
        coverage.append(
            {
                "symbol": symbol,
                "kline_rows": len(kline),
                "premium_rows": len(premium),
                "metric_rows": len(metric),
                "funding_events": len(funding_events),
                "first": None if kline.empty else kline.open_time.iloc[0],
                "last": None if kline.empty else kline.open_time.iloc[-1],
            }
        )
        if kline.empty or premium.empty or metric.empty:
            continue
        frames[symbol] = base.build_features(kline, premium, metric)
        funding[symbol] = funding_events
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)

    config_rows: list[dict[str, object]] = []
    stores: dict[str, dict[str, pd.DataFrame]] = {}
    periods = {
        "2025H2": (START, CUT),
        "2026H1": (CUT, PRE_JULY_END),
        "JULY2026": (PRE_JULY_END, JULY_END),
    }
    for cfg in configs():
        stores[cfg.name] = {}
        for label, bounds in periods.items():
            trades = pd.concat(
                [simulate(symbol, frame, funding[symbol], cfg, *bounds) for symbol, frame in frames.items()],
                ignore_index=True,
            ) if frames else pd.DataFrame()
            stores[cfg.name][label] = trades
            config_rows.append(
                {
                    "config": cfg.name,
                    "period": label,
                    **asdict(cfg),
                    **metrics(trades, STRESS_COST),
                }
            )
    results = pd.DataFrame(config_rows)
    results.to_csv(output / "ALL_CONFIG_RESULTS.csv", index=False)

    selections: list[dict[str, object]] = []
    for cfg in configs():
        a = metrics(stores[cfg.name]["2025H2"], STRESS_COST)
        b = metrics(stores[cfg.name]["2026H1"], STRESS_COST)
        score = selection_score(a, b)
        selections.append(
            {
                "config": cfg.name,
                "score": score,
                "eligible": score > -1e8,
                **{f"h2_2025_{key}": value for key, value in a.items()},
                **{f"h1_2026_{key}": value for key, value in b.items()},
            }
        )
    selection = pd.DataFrame(selections).sort_values("score", ascending=False)
    selection.to_csv(output / "SELECTION_BEFORE_JULY.csv", index=False)
    chosen_name = str(selection.iloc[0].config)
    chosen = next(cfg for cfg in configs() if cfg.name == chosen_name)
    july = stores[chosen_name]["JULY2026"].copy()
    july.to_csv(output / "FIXED_JULY_TRADES.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label in ("2025H2", "2026H1", "JULY2026"):
        frame = stores[chosen_name][label]
        for risk in (1.0, 2.0, 3.0, 5.0, 7.5, 10.0):
            account_rows.append({"period": label, **account(frame, risk, STRESS_COST)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols_requested": len(SYMBOLS),
        "symbols_with_data": len(frames),
        "configs": len(configs()),
        "eligible_configs": int(selection.eligible.sum()),
        "chosen": asdict(chosen),
        "july_20bps": metrics(july, STRESS_COST),
        "july_12bps": metrics(july, BASE_COST),
        "account_scenarios": account_rows,
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str))
    (output / "REPORT_RU.md").write_text(
        "# Round 36 — OI continuation\n\n"
        "Конфигурация выбиралась только по 2025 H2 и 2026 H1; July 2026 прочитан после фиксации.\n\n"
        "## Выбор до июля\n\n"
        + selection.head(20).to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Фактический July 2026\n\n```json\n"
        + json.dumps(summary["july_20bps"], indent=2)
        + "\n```\n\n## Риск-профили\n\n"
        + accounts.to_markdown(index=False, floatfmt=".3f")
        + "\n"
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
