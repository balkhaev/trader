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
    fraction_down: float
    market_move: float
    coin_move: float
    hold: int
    strict_reclaim: bool


CONFIGS = [
    Config("CAP30_M10_C15_H45", 0.30, -1.0, -1.5, 3, False),
    Config("CAP50_M10_C15_H45", 0.50, -1.0, -1.5, 3, False),
    Config("CAP50_M15_C20_H45", 0.50, -1.5, -2.0, 3, False),
    Config("CAP70_M15_C20_H45", 0.70, -1.5, -2.0, 3, False),
    Config("CAP30_M10_C15_H60", 0.30, -1.0, -1.5, 4, False),
    Config("CAP50_M10_C15_H60", 0.50, -1.0, -1.5, 4, False),
    Config("CAP50_M15_C20_H60", 0.50, -1.5, -2.0, 4, False),
    Config("CAP50_STRICT_H60", 0.50, -1.0, -1.5, 4, True),
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
    def context(group: pd.DataFrame) -> pd.Series:
        x = group.move3.dropna()
        return pd.Series({
            "market_count": len(x),
            "market_median": x.median() if len(x) else np.nan,
            "fraction_below_m10": float((x <= -1.0).mean()) if len(x) else np.nan,
            "fraction_below_m15": float((x <= -1.5).mean()) if len(x) else np.nan,
        })
    ctx = panel.groupby("open_time").apply(context, include_groups=False).reset_index()
    return panel.merge(ctx, on="open_time", how="left").sort_values(["open_time", "symbol"])


def signal_events(panel: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    fraction_col = "fraction_below_m10" if cfg.market_move == -1.0 else "fraction_below_m15"
    base = (
        panel.contig4.fillna(False)
        & (panel.market_count >= 40)
        & (panel.market_median <= cfg.market_move)
        & (panel[fraction_col] >= cfg.fraction_down)
        & (panel.move3 <= cfg.coin_move)
        & (panel.volz >= 0.5)
        & (panel.lwick >= (0.50 if cfg.strict_reclaim else 0.35))
        & (panel.cpos >= (0.65 if cfg.strict_reclaim else 0.55))
        & (panel.imb1 >= (0.0 if cfg.strict_reclaim else -0.10))
    )
    candidates = panel[base].copy()
    if candidates.empty:
        return candidates
    candidates["strength"] = (
        -candidates.move3
        + candidates.lwick
        + candidates.cpos
        + candidates.volz.clip(lower=0) / 3
        + candidates.imb1.clip(lower=0)
    )
    candidates["event_size"] = candidates.groupby("open_time").symbol.transform("count")
    candidates = candidates[candidates.event_size >= 3]
    return (
        candidates.sort_values(["open_time", "strength"], ascending=[True, False])
        .groupby("open_time", group_keys=False)
        .head(3)
        .rename(columns={"open_time": "event_time"})
        .reset_index(drop=True)
    )


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
    indexes = {s: {t: i for i, t in enumerate(f.open_time)} for s, f in frames.items()}
    arrays = {
        s: {c: f[c].to_numpy(float) for c in ("open", "high", "low", "atr")}
        for s, f in frames.items()
    }
    times = {s: list(f.open_time) for s, f in frames.items()}
    fns = {s: x.astype("int64").to_numpy() for s, x in funding.items()}
    last_exit = {s: -1 for s in frames}
    trades = []
    events = events[(events.event_time >= start) & (events.event_time < end)].sort_values(
        ["event_time", "strength"], ascending=[True, False]
    )
    for _, row in events.iterrows():
        symbol = str(row.symbol)
        si = indexes[symbol].get(row.event_time)
        if si is None or si <= last_exit[symbol]:
            continue
        ei = si + 1
        scheduled = ei + cfg.hold
        if scheduled >= len(times[symbol]):
            continue
        entry_time = times[symbol][ei]
        exit_time = times[symbol][scheduled]
        if not (start <= entry_time < end) or exit_time >= end:
            continue
        if entry_time.date() != exit_time.date():
            continue
        if crosses(fns[symbol], int(entry_time.value), int(exit_time.value)):
            continue
        arr = arrays[symbol]
        entry = arr["open"][ei]
        atr_value = arr["atr"][si]
        if not np.isfinite(atr_value):
            continue
        stop = entry - 1.5 * atr_value
        target = entry + 3.0 * atr_value
        exit_price = arr["open"][scheduled]
        exit_index = scheduled
        reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for bi in range(ei, scheduled):
            mae_bps = min(mae_bps, (arr["low"][bi] / entry - 1) * 1e4)
            mfe_bps = max(mfe_bps, (arr["high"][bi] / entry - 1) * 1e4)
            if arr["open"][bi] <= stop:
                exit_price, exit_index, reason = arr["open"][bi], bi, "stop_gap"
                break
            if arr["low"][bi] <= stop:
                exit_price, exit_index, reason = stop, bi, "stop"
                break
            if arr["high"][bi] >= target:
                exit_price, exit_index, reason = target, bi, "target"
                break
        gross_bps = (exit_price / entry - 1) * 1e4
        trades.append({
            "config": cfg.name,
            "event_time": row.event_time,
            "symbol": symbol,
            "entry_time": entry_time,
            "exit_time": times[symbol][exit_index],
            "gross_bps": gross_bps,
            "net_bps": gross_bps - BASE_COST,
            "strength": float(row.strength),
            "event_size": int(row.event_size),
            "reason": reason,
            "mae_bps": mae_bps,
            "mfe_bps": mfe_bps,
        })
        last_exit[symbol] = exit_index
    return pd.DataFrame(trades)


def metrics(df: pd.DataFrame, cost: float = BASE_COST) -> dict[str, float | int]:
    if df.empty:
        return {"trades": 0, "events": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "event_avg_bps": np.nan, "event_pf": np.nan}
    x = df.gross_bps.to_numpy(float) - cost
    gains = x[x > 0]
    losses = -x[x < 0]
    event = df.assign(adjusted=x).groupby("event_time").adjusted.mean()
    eg = event[event > 0]
    el = -event[event < 0]
    return {
        "trades": int(len(x)),
        "events": int(len(event)),
        "avg_bps": float(x.mean()),
        "pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "win_rate": float(np.mean(x > 0)),
        "event_avg_bps": float(event.mean()),
        "event_pf": float(eg.sum() / el.sum()) if el.sum() else float("inf"),
        "event_win_rate": float(np.mean(event > 0)),
        "total_bps": float(x.sum()),
        "best_bps": float(x.max()),
        "worst_bps": float(x.min()),
    }


def bootstrap(df: pd.DataFrame, n: int = 30000) -> dict[str, float]:
    if df.empty:
        return {"lo": np.nan, "hi": np.nan, "p_positive": np.nan}
    events = df.groupby("event_time").net_bps.mean().reset_index()
    day = pd.to_datetime(events.event_time, utc=True).dt.floor("D")
    groups = [g.net_bps.to_numpy(float) for _, g in events.groupby(day)]
    rng = np.random.default_rng(2501)
    values = np.empty(n)
    for i in range(n):
        values[i] = np.concatenate([groups[j] for j in rng.integers(0, len(groups), len(groups))]).mean()
    return {
        "lo": float(np.quantile(values, 0.025)),
        "hi": float(np.quantile(values, 0.975)),
        "p_positive": float(np.mean(values > 0)),
    }


def portfolio(df: pd.DataFrame, cost: float, capital: float = 10_000.0) -> dict[str, float | int]:
    if df.empty:
        return {}
    events = df.assign(adjusted=df.gross_bps - cost).groupby("event_time").agg(
        event_bps=("adjusted", "mean"), legs=("adjusted", "size")
    ).reset_index()
    equity = capital
    for _, event in events.sort_values("event_time").iterrows():
        gross = min(float(event.legs) * 0.06, 0.18)
        equity += equity * gross * float(event.event_bps) / 1e4
    days = int((JULY_END - PRE_JULY_END).days)
    return {
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "mechanical_annualized_pct": ((equity / capital) ** (365 / days) - 1) * 100,
        "events": int(len(events)),
        "trades": int(events.legs.sum()),
        "events_per_day": float(len(events) / days),
        "notional_per_leg_pct": 6.0,
        "max_gross_pct": 18.0,
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

    frames = {}
    funding = {}
    coverage = []
    for symbol in SYMBOLS:
        raw = load_klines(symbol, manifest, include_july=True)
        events = load_funding(symbol, manifest, include_july=True)
        coverage.append({"symbol": symbol, "rows": len(raw), "first": None if raw.empty else raw.open_time.iloc[0], "last": None if raw.empty else raw.open_time.iloc[-1]})
        if raw.empty:
            continue
        frames[symbol] = features(raw)
        funding[symbol] = events
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)
    panel = build_panel(frames)

    stores = {}
    grid_rows = []
    for cfg in CONFIGS:
        event_frame = signal_events(panel, cfg)
        stores[cfg.name] = {}
        for label, bounds in {"2025H2": (START, CUT), "2026H1": (CUT, PRE_JULY_END)}.items():
            trades = simulate(event_frame, frames, funding, cfg, *bounds)
            stores[cfg.name][label] = trades
            grid_rows.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics(trades)})
    pd.DataFrame(grid_rows).to_csv(output / "CONFIG_RESULTS_PRE_JULY.csv", index=False)

    selection_rows = []
    for cfg in CONFIGS:
        a = metrics(stores[cfg.name]["2025H2"])
        b = metrics(stores[cfg.name]["2026H1"])
        eligible = (
            a["events"] >= 20 and b["events"] >= 20
            and a["event_avg_bps"] > 0 and b["event_avg_bps"] > 0
            and a["event_pf"] > 1.05 and b["event_pf"] > 1.05
        )
        score = (
            min(a["event_avg_bps"], b["event_avg_bps"])
            * math.sqrt(min(a["events"], b["events"]) / 40)
            * min(a["event_pf"], b["event_pf"], 3)
            if eligible else -1e9
        )
        selection_rows.append({
            "config": cfg.name, "eligible": eligible, "score": score,
            "events_2025H2": a["events"], "event_avg_2025H2": a["event_avg_bps"], "event_pf_2025H2": a["event_pf"],
            "events_2026H1": b["events"], "event_avg_2026H1": b["event_avg_bps"], "event_pf_2026H1": b["event_pf"],
        })
    selection = pd.DataFrame(selection_rows).sort_values("score", ascending=False)
    selection.to_csv(output / "SELECTION_BEFORE_JULY.csv", index=False)
    chosen = next(c for c in CONFIGS if c.name == str(selection.iloc[0].config))
    july_frame = signal_events(panel, chosen)
    july = simulate(july_frame, frames, funding, chosen, PRE_JULY_END, JULY_END)
    july.to_csv(output / "JULY_TRADES.csv", index=False)
    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "chosen": asdict(chosen),
        "eligible_configs": int(selection.eligible.sum()),
        "selection": selection.to_dict(orient="records"),
        "july_12bps": metrics(july),
        "july_20bps": metrics(july, STRESS_COST),
        "july_bootstrap": bootstrap(july),
        "portfolio_12bps": portfolio(july, BASE_COST),
        "portfolio_20bps": portfolio(july, STRESS_COST),
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2))
    (output / "REPORT_RU.md").write_text(
        "# Round 25 — market-wide capitulation rebound\n\n"
        "## Selection before July\n\n" + selection.to_markdown(index=False, floatfmt=".2f")
        + "\n\n## July\n\n```json\n" + json.dumps(summary, indent=2) + "\n```\n"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
