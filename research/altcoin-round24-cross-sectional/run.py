from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from config import CUT, JULY_END, PRE_JULY_END, START, SYMBOLS
from data import download_july, download_monthly, load_funding, load_klines
from strategy import features

BASE_COST = 12.0
STRESS_COST = 20.0


@dataclass(frozen=True)
class Config:
    name: str
    mode: str  # reversal or momentum
    threshold: float
    k: int
    hold: int
    high_dispersion: bool
    flow_filter: bool


CONFIGS = [
    Config("REV_Z15_K3_H30", "reversal", 1.5, 3, 2, False, False),
    Config("REV_Z15_K3_H60", "reversal", 1.5, 3, 4, False, False),
    Config("REV_Z20_K3_H60", "reversal", 2.0, 3, 4, False, False),
    Config("REV_Z15_K5_H60", "reversal", 1.5, 5, 4, False, False),
    Config("REV_Z15_K3_H60_DISP", "reversal", 1.5, 3, 4, True, False),
    Config("REV_Z15_K3_H60_FLOW", "reversal", 1.5, 3, 4, False, True),
    Config("MOM_Z15_K3_H30", "momentum", 1.5, 3, 2, False, False),
    Config("MOM_Z15_K3_H60", "momentum", 1.5, 3, 4, False, False),
    Config("MOM_Z20_K3_H60", "momentum", 2.0, 3, 4, False, False),
    Config("MOM_Z15_K5_H60", "momentum", 1.5, 5, 4, False, False),
    Config("MOM_Z15_K3_H60_DISP", "momentum", 1.5, 3, 4, True, False),
    Config("MOM_Z15_K3_H60_FLOW", "momentum", 1.5, 3, 4, False, True),
]


def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def build_panel(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    pieces = []
    for symbol, frame in frames.items():
        cols = [
            "open_time", "open", "high", "low", "close", "atr", "move3",
            "imb1", "volz", "cpos", "lwick", "uwick", "contig4",
        ]
        pieces.append(frame[cols].assign(symbol=symbol))
    panel = pd.concat(pieces, ignore_index=True)
    context = panel.groupby("open_time").move3.agg(
        market_median="median", market_std="std", market_count="count"
    ).reset_index()
    context = context.sort_values("open_time")
    context["dispersion_reference"] = (
        context.market_std.rolling(672, min_periods=192).median().shift(1)
    )
    panel = panel.merge(context, on="open_time", how="left")
    panel["z"] = (panel.move3 - panel.market_median) / panel.market_std.replace(0, np.nan)
    return panel.sort_values(["open_time", "symbol"]).reset_index(drop=True)


def signal_events(panel: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    rows: list[pd.DataFrame] = []
    for timestamp, group in panel.groupby("open_time", sort=True):
        g = group[
            group.contig4.fillna(False)
            & group.z.notna()
            & (group.market_count >= 40)
        ].copy()
        if cfg.high_dispersion:
            g = g[g.market_std >= g.dispersion_reference]
        if g.empty:
            continue
        low = g[g.z <= -cfg.threshold].nsmallest(cfg.k, "z").copy()
        high = g[g.z >= cfg.threshold].nlargest(cfg.k, "z").copy()
        if len(low) < cfg.k or len(high) < cfg.k:
            continue
        if cfg.mode == "reversal":
            low["side"] = 1
            high["side"] = -1
        else:
            low["side"] = -1
            high["side"] = 1
        selected = pd.concat([low, high], ignore_index=True)
        if cfg.flow_filter:
            long_ok = (selected.side == 1) & (selected.imb1 >= 0) & (selected.cpos >= 0.55)
            short_ok = (selected.side == -1) & (selected.imb1 <= 0) & (selected.cpos <= 0.45)
            selected = selected[long_ok | short_ok]
            if selected.side.eq(1).sum() < 2 or selected.side.eq(-1).sum() < 2:
                continue
        selected["event_time"] = timestamp
        selected["event_size"] = len(selected)
        selected["strength"] = selected.z.abs() + selected.volz.clip(lower=0).fillna(0) / 4
        rows.append(selected)
    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True)


def simulate(
    events: pd.DataFrame,
    frames: dict[str, pd.DataFrame],
    funding: dict[str, pd.DatetimeIndex],
    cfg: Config,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> pd.DataFrame:
    if events.empty:
        return pd.DataFrame()
    indexes = {
        symbol: {time: i for i, time in enumerate(frame.open_time)}
        for symbol, frame in frames.items()
    }
    arrays = {
        symbol: {
            key: frame[key].to_numpy(float)
            for key in ("open", "high", "low", "atr")
        }
        for symbol, frame in frames.items()
    }
    times = {symbol: list(frame.open_time) for symbol, frame in frames.items()}
    funding_ns = {symbol: idx.astype("int64").to_numpy() for symbol, idx in funding.items()}
    last_exit: dict[str, int] = {symbol: -1 for symbol in frames}
    trades: list[dict[str, object]] = []
    events = events[(events.event_time >= start) & (events.event_time < end)].sort_values(
        ["event_time", "strength"], ascending=[True, False]
    )
    for _, row in events.iterrows():
        symbol = str(row.symbol)
        if symbol not in frames:
            continue
        signal_index = indexes[symbol].get(row.event_time)
        if signal_index is None or signal_index <= last_exit[symbol]:
            continue
        entry_index = signal_index + 1
        exit_index_scheduled = entry_index + cfg.hold
        frame_times = times[symbol]
        if exit_index_scheduled >= len(frame_times):
            continue
        entry_time = frame_times[entry_index]
        scheduled_time = frame_times[exit_index_scheduled]
        if not (start <= entry_time < end) or scheduled_time >= end:
            continue
        if entry_time.date() != scheduled_time.date():
            continue
        if crosses(
            funding_ns[symbol],
            int(entry_time.value),
            int(scheduled_time.value),
        ):
            continue
        side = int(row.side)
        arr = arrays[symbol]
        entry = arr["open"][entry_index]
        atr_value = arr["atr"][signal_index]
        if not np.isfinite(atr_value):
            continue
        stop = entry - side * 1.5 * atr_value
        risk = abs(entry - stop)
        target = entry + side * 2.0 * risk
        exit_price = arr["open"][exit_index_scheduled]
        exit_index = exit_index_scheduled
        reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for bar_index in range(entry_index, exit_index_scheduled):
            excursions = [
                side * (arr["high"][bar_index] / entry - 1) * 1e4,
                side * (arr["low"][bar_index] / entry - 1) * 1e4,
            ]
            mae_bps = min(mae_bps, *excursions)
            mfe_bps = max(mfe_bps, *excursions)
            if side == 1 and arr["open"][bar_index] <= stop:
                exit_price, exit_index, reason = arr["open"][bar_index], bar_index, "stop_gap"
                break
            if side == -1 and arr["open"][bar_index] >= stop:
                exit_price, exit_index, reason = arr["open"][bar_index], bar_index, "stop_gap"
                break
            if side == 1 and arr["low"][bar_index] <= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
            if side == -1 and arr["high"][bar_index] >= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
            if side == 1 and arr["high"][bar_index] >= target:
                exit_price, exit_index, reason = target, bar_index, "target"
                break
            if side == -1 and arr["low"][bar_index] <= target:
                exit_price, exit_index, reason = target, bar_index, "target"
                break
        gross_bps = side * (exit_price / entry - 1) * 1e4
        trades.append({
            "config": cfg.name,
            "event_time": row.event_time,
            "symbol": symbol,
            "side": side,
            "entry_time": entry_time,
            "exit_time": frame_times[exit_index],
            "gross_bps": gross_bps,
            "net_bps": gross_bps - BASE_COST,
            "z": float(row.z),
            "strength": float(row.strength),
            "reason": reason,
            "mae_bps": mae_bps,
            "mfe_bps": mfe_bps,
        })
        last_exit[symbol] = exit_index
    return pd.DataFrame(trades)


def leg_metrics(df: pd.DataFrame, cost: float = BASE_COST) -> dict[str, float | int]:
    if df.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "total_bps": 0.0}
    values = df.gross_bps.to_numpy(float) - cost
    gains = values[values > 0]
    losses = -values[values < 0]
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "total_bps": float(values.sum()),
        "best_bps": float(values.max()),
        "worst_bps": float(values.min()),
    }


def event_returns(df: pd.DataFrame, cost: float = BASE_COST) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["event_time", "event_bps", "legs", "longs", "shorts"])
    x = df.copy()
    x["adjusted"] = x.gross_bps - cost
    return x.groupby("event_time").agg(
        event_bps=("adjusted", "mean"),
        legs=("adjusted", "size"),
        longs=("side", lambda s: int((s == 1).sum())),
        shorts=("side", lambda s: int((s == -1).sum())),
    ).reset_index()


def event_metrics(df: pd.DataFrame, cost: float = BASE_COST) -> dict[str, float | int]:
    events = event_returns(df, cost)
    if events.empty:
        return {"events": 0, "event_avg_bps": np.nan, "event_pf": np.nan, "event_win_rate": np.nan}
    values = events.event_bps.to_numpy(float)
    gains = values[values > 0]
    losses = -values[values < 0]
    return {
        "events": int(len(values)),
        "event_avg_bps": float(values.mean()),
        "event_pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "event_win_rate": float(np.mean(values > 0)),
    }


def bootstrap(df: pd.DataFrame, n: int = 30000) -> dict[str, float]:
    events = event_returns(df)
    if events.empty:
        return {"lo": np.nan, "hi": np.nan, "p_positive": np.nan}
    day = pd.to_datetime(events.event_time, utc=True).dt.floor("D")
    groups = [g.event_bps.to_numpy(float) for _, g in events.groupby(day)]
    rng = np.random.default_rng(2401)
    result = np.empty(n)
    for i in range(n):
        result[i] = np.concatenate([groups[j] for j in rng.integers(0, len(groups), len(groups))]).mean()
    return {
        "lo": float(np.quantile(result, 0.025)),
        "hi": float(np.quantile(result, 0.975)),
        "p_positive": float(np.mean(result > 0)),
    }


def portfolio(df: pd.DataFrame, cost: float, capital: float = 10_000.0) -> dict[str, float | int]:
    events = event_returns(df, cost)
    if events.empty:
        return {}
    equity = capital
    fraction_per_leg = 0.04
    for _, event in events.sort_values("event_time").iterrows():
        gross_fraction = min(float(event.legs) * fraction_per_leg, 0.48)
        equity += equity * gross_fraction * float(event.event_bps) / 1e4
    days = int((JULY_END - PRE_JULY_END).days)
    return {
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "mechanical_annualized_pct": ((equity / capital) ** (365 / days) - 1) * 100,
        "events": int(len(events)),
        "legs": int(events.legs.sum()),
        "events_per_day": float(len(events) / days),
        "notional_per_leg_pct": fraction_per_leg * 100,
        "max_gross_pct": 48.0,
        "cost_bps": cost,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = download_monthly(SYMBOLS, cache, args.workers)
    manifest += download_july(SYMBOLS, cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    frames: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage = []
    for symbol in SYMBOLS:
        raw = load_klines(symbol, manifest, include_july=True)
        events = load_funding(symbol, manifest, include_july=True)
        coverage.append({
            "symbol": symbol,
            "rows": len(raw),
            "first": None if raw.empty else raw.open_time.iloc[0],
            "last": None if raw.empty else raw.open_time.iloc[-1],
            "funding_events": len(events),
        })
        if raw.empty:
            continue
        frames[symbol] = features(raw)
        funding[symbol] = events
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)
    panel = build_panel(frames)

    stores: dict[str, dict[str, pd.DataFrame]] = {}
    rows = []
    for cfg in CONFIGS:
        signal_frame = signal_events(panel, cfg)
        stores[cfg.name] = {}
        for label, bounds in {
            "2025H2": (START, CUT),
            "2026H1": (CUT, PRE_JULY_END),
        }.items():
            trades = simulate(signal_frame, frames, funding, cfg, *bounds)
            stores[cfg.name][label] = trades
            rows.append({
                "config": cfg.name,
                "period": label,
                **asdict(cfg),
                **leg_metrics(trades),
                **event_metrics(trades),
            })
    grid = pd.DataFrame(rows)
    grid.to_csv(output / "CONFIG_RESULTS_PRE_JULY.csv", index=False)

    selection_rows = []
    for cfg in CONFIGS:
        a = {**leg_metrics(stores[cfg.name]["2025H2"]), **event_metrics(stores[cfg.name]["2025H2"])}
        b = {**leg_metrics(stores[cfg.name]["2026H1"]), **event_metrics(stores[cfg.name]["2026H1"])}
        eligible = (
            a["events"] >= 60
            and b["events"] >= 60
            and a["event_avg_bps"] > 0
            and b["event_avg_bps"] > 0
            and a["event_pf"] > 1.05
            and b["event_pf"] > 1.05
        )
        score = (
            min(a["event_avg_bps"], b["event_avg_bps"])
            * math.sqrt(min(a["events"], b["events"]) / 100)
            * min(a["event_pf"], b["event_pf"], 3)
            if eligible else -1e9
        )
        selection_rows.append({
            "config": cfg.name,
            "eligible": eligible,
            "score": score,
            "events_2025H2": a["events"],
            "event_avg_2025H2": a["event_avg_bps"],
            "event_pf_2025H2": a["event_pf"],
            "events_2026H1": b["events"],
            "event_avg_2026H1": b["event_avg_bps"],
            "event_pf_2026H1": b["event_pf"],
        })
    selection = pd.DataFrame(selection_rows).sort_values("score", ascending=False)
    selection.to_csv(output / "SELECTION_BEFORE_JULY.csv", index=False)
    chosen_name = str(selection.iloc[0].config)
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)
    july_events = signal_events(panel, chosen)
    july = simulate(july_events, frames, funding, chosen, PRE_JULY_END, JULY_END)
    july.to_csv(output / "JULY_TRADES.csv", index=False)
    event_returns(july).to_csv(output / "JULY_EVENTS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "chosen": asdict(chosen),
        "eligible_configs": int(selection.eligible.sum()),
        "selection": selection.to_dict(orient="records"),
        "july_legs_12bps": leg_metrics(july),
        "july_events_12bps": event_metrics(july),
        "july_legs_20bps": leg_metrics(july, STRESS_COST),
        "july_events_20bps": event_metrics(july, STRESS_COST),
        "july_event_bootstrap": bootstrap(july),
        "portfolio_12bps": portfolio(july, BASE_COST),
        "portfolio_20bps": portfolio(july, STRESS_COST),
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2))
    (output / "REPORT_RU.md").write_text(
        "# Round 24 — cross-sectional market-neutral\n\n"
        "## Selection before July\n\n"
        + selection.to_markdown(index=False, floatfmt=".2f")
        + "\n\n## July\n\n```json\n"
        + json.dumps(summary, indent=2)
        + "\n```\n"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
