from __future__ import annotations

import argparse
import importlib.util
import itertools
import json
import math
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parents[1] / "altcoin-round34-trend" / "run.py"
spec = importlib.util.spec_from_file_location("round34_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round34 base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOLS = base.SYMBOLS
START = base.START
CUT1 = base.CUT1
CUT2 = base.CUT2
CUT3 = base.CUT3
PRE_JULY_END = base.PRE_JULY_END
END = base.END
BASE_COST = base.BASE_COST
STRESS_COST = base.STRESS_COST


@dataclass(frozen=True)
class Config:
    name: str
    family: str
    lookback: int
    volume_z: float
    confirm_bars: int
    hold: int
    stop_atr: float


CONFIGS = [
    Config(
        f"{family.upper()}_L{lookback}_V{volume_z:g}_C{confirm}_H{hold}_S{stop:g}",
        family,
        lookback,
        volume_z,
        confirm,
        hold,
        stop,
    )
    for family, lookback, volume_z, confirm, hold, stop in itertools.product(
        ["fade", "accept"],
        [16, 32],
        [0.0, 0.75],
        [1, 2],
        [4, 8],
        [1.25, 1.75],
    )
]


def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def close_position(open_: float, high: float, low: float, close: float) -> float:
    span = high - low
    return (close - low) / span if span > 0 else 0.5


def simulate(symbol, frame, funding, cfg, start, end):
    hi_level = frame[f"hi{cfg.lookback}"].to_numpy(float)
    lo_level = frame[f"lo{cfg.lookback}"].to_numpy(float)
    close = frame.close.to_numpy(float)
    open_price = frame.open.to_numpy(float)
    high = frame.high.to_numpy(float)
    low = frame.low.to_numpy(float)
    atr_value = frame.atr.to_numpy(float)
    volz = frame.volz.to_numpy(float)
    h4trend = frame.h4trend.to_numpy(float)
    times = list(frame.open_time)
    time_ns = frame.open_time.astype("int64").to_numpy()
    events_ns = funding.astype("int64").to_numpy()
    first = np.searchsorted(time_ns, start.value)
    final = np.searchsorted(time_ns, end.value)
    long_break = (close > hi_level) & (volz >= cfg.volume_z)
    short_break = (close < lo_level) & (volz >= cfg.volume_z)
    candidates = np.flatnonzero((long_break | short_break) & (np.arange(len(frame)) >= first) & (np.arange(len(frame)) < final))
    output = []
    last_exit = -1
    for break_index in candidates:
        if break_index <= last_exit or not np.isfinite(atr_value[break_index]):
            continue
        breakout_side = 1 if long_break[break_index] else -1
        level = hi_level[break_index] if breakout_side == 1 else lo_level[break_index]
        if not np.isfinite(level):
            continue
        trigger_index = None
        if cfg.family == "fade":
            for offset in range(1, cfg.confirm_bars + 1):
                idx = break_index + offset
                if idx >= final:
                    break
                cpos = close_position(open_price[idx], high[idx], low[idx], close[idx])
                reclaimed = close[idx] <= level if breakout_side == 1 else close[idx] >= level
                rejection = cpos <= 0.55 if breakout_side == 1 else cpos >= 0.45
                if reclaimed and rejection:
                    trigger_index = idx
                    break
            if trigger_index is None:
                continue
            side = -breakout_side
        else:
            end_confirm = break_index + cfg.confirm_bars
            if end_confirm >= final:
                continue
            accepted = True
            for idx in range(break_index + 1, end_confirm + 1):
                outside = close[idx] > level if breakout_side == 1 else close[idx] < level
                if not outside:
                    accepted = False
                    break
            if not accepted:
                continue
            if breakout_side == 1 and h4trend[end_confirm] <= 0:
                continue
            if breakout_side == -1 and h4trend[end_confirm] >= 0:
                continue
            trigger_index = end_confirm
            side = breakout_side
        entry_index = trigger_index + 1
        scheduled_exit = entry_index + cfg.hold
        if scheduled_exit >= final or times[entry_index].date() != times[scheduled_exit].date():
            continue
        if crosses(events_ns, int(time_ns[entry_index]), int(time_ns[scheduled_exit])):
            continue
        entry = open_price[entry_index]
        signal_atr = atr_value[trigger_index]
        if not np.isfinite(signal_atr) or entry <= 0:
            continue
        stop = entry - side * cfg.stop_atr * signal_atr
        exit_price, exit_index, reason = open_price[scheduled_exit], scheduled_exit, "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for bar_index in range(entry_index, scheduled_exit):
            excursions = [side * (high[bar_index] / entry - 1) * 1e4, side * (low[bar_index] / entry - 1) * 1e4]
            mae_bps = min(mae_bps, *excursions)
            mfe_bps = max(mfe_bps, *excursions)
            if side == 1 and open_price[bar_index] <= stop:
                exit_price, exit_index, reason = open_price[bar_index], bar_index, "stop_gap"; break
            if side == -1 and open_price[bar_index] >= stop:
                exit_price, exit_index, reason = open_price[bar_index], bar_index, "stop_gap"; break
            if side == 1 and low[bar_index] <= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"; break
            if side == -1 and high[bar_index] >= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"; break
        gross_bps = side * (exit_price / entry - 1) * 1e4
        output.append({
            "config": cfg.name, "family": cfg.family, "symbol": symbol, "side": side,
            "breakout_side": breakout_side, "breakout_time": times[break_index],
            "trigger_time": times[trigger_index], "entry_time": times[entry_index],
            "exit_time": times[exit_index], "gross_bps": gross_bps,
            "net20_bps": gross_bps - STRESS_COST,
            "stop_distance_bps": abs(entry - stop) / entry * 1e4,
            "strength": max(float(volz[break_index]), 0.0), "reason": reason,
            "mae_bps": mae_bps, "mfe_bps": mfe_bps,
        })
        last_exit = exit_index
    return output


def metrics(frame, cost):
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "symbols": 0, "breadth": 0.0}
    values = frame.gross_bps.to_numpy(float) - cost
    gains = values[values > 0].sum(); losses = -values[values < 0].sum()
    per_symbol = frame.assign(net=values).groupby("symbol").net.agg(["mean", "size"])
    eligible = per_symbol[per_symbol["size"] >= 5]
    return {"trades": int(len(frame)), "avg_bps": float(values.mean()), "pf": float(gains / losses) if losses else float("inf"), "win_rate": float(np.mean(values > 0)), "symbols": int(frame.symbol.nunique()), "breadth": float((eligible["mean"] > 0).mean()) if len(eligible) else 0.0}


def account(frame, risk_pct, cost, start, end, initial=10000.0, max_positions=4):
    data = frame[(pd.to_datetime(frame.entry_time, utc=True) >= start) & (pd.to_datetime(frame.entry_time, utc=True) < end)].sort_values(["entry_time", "strength"], ascending=[True, False]).reset_index(drop=True)
    if data.empty:
        return {}
    equity = initial; open_positions = {}; curve = []; accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)):
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += float(position["notional"]) * (float(row.gross_bps) - cost) / 1e4; del open_positions[index]; accepted += 1
        for index in data.index[data.entry_time == timestamp]:
            row = data.iloc[index]
            if len(open_positions) >= max_positions or any(position["symbol"] == row.symbol for position in open_positions.values()):
                continue
            stop_fraction = (float(row.stop_distance_bps) + cost) / 1e4
            desired = min(equity * (risk_pct / 100) / stop_fraction, equity * 2.0)
            gross_now = sum(float(position["notional"]) for position in open_positions.values())
            desired = min(desired, max(0.0, equity * 6.0 - gross_now))
            if desired > 0:
                open_positions[index] = {"symbol": row.symbol, "notional": desired}
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += float(position["notional"]) * (float(row.gross_bps) - cost) / 1e4; del open_positions[index]; accepted += 1
        curve.append(equity)
    values = np.asarray(curve); drawdown = 1 - values / np.maximum.accumulate(values); years = (end - start).days / 365.25
    return {"risk_pct": risk_pct, "accepted_trades": accepted, "return_pct": (equity / initial - 1) * 100, "cagr_pct": ((equity / initial) ** (1 / years) - 1) * 100 if equity > 0 else -100.0, "closed_dd_pct": float(drawdown.max() * 100), "final_equity_usd": equity}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--output", required=True); parser.add_argument("--cache", required=True); parser.add_argument("--workers", type=int, default=32); args = parser.parse_args()
    output = Path(args.output); cache = Path(args.cache); output.mkdir(parents=True, exist_ok=True); cache.mkdir(parents=True, exist_ok=True)
    manifest = base.download_all(cache, args.workers); pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)
    features = {}; funding = {}; coverage = []
    for symbol in SYMBOLS:
        raw = base.load_klines(symbol, manifest); events = base.load_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "rows": len(raw), "first": None if raw.empty else raw.open_time.iloc[0], "last": None if raw.empty else raw.open_time.iloc[-1], "funding_events": len(events)})
        if not raw.empty:
            features[symbol] = base.build_features(raw); funding[symbol] = events
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)
    periods = {"2024": (START, CUT1), "2025H1": (CUT1, CUT2), "2025H2": (CUT2, CUT3), "2026H1": (CUT3, PRE_JULY_END), "JULY2026": (PRE_JULY_END, END)}
    stores = {}; rows = []
    for cfg_index, cfg in enumerate(CONFIGS, 1):
        for label, bounds in periods.items():
            trades = []
            for symbol, feature in features.items(): trades += simulate(symbol, feature, funding[symbol], cfg, *bounds)
            frame = pd.DataFrame(trades); stores[(cfg.name, label)] = frame
            rows.append({"config": cfg.name, "period": label, **asdict(cfg), **{f"base_{key}": value for key, value in metrics(frame, BASE_COST).items()}, **{f"stress_{key}": value for key, value in metrics(frame, STRESS_COST).items()}})
        if cfg_index % 8 == 0: print(f"configs {cfg_index}/{len(CONFIGS)}", flush=True)
    grid = pd.DataFrame(rows); grid.to_csv(output / "CONFIG_RESULTS.csv", index=False)
    selection_rows = []
    for cfg in CONFIGS:
        first = grid[(grid.config == cfg.name) & (grid.period == "2024")].iloc[0]; second = grid[(grid.config == cfg.name) & (grid.period == "2025H1")].iloc[0]
        eligible = first.stress_trades >= 100 and second.stress_trades >= 50 and first.stress_avg_bps > 0 and second.stress_avg_bps > 0 and first.stress_pf >= 1.10 and second.stress_pf >= 1.10 and first.stress_breadth >= 0.40 and second.stress_breadth >= 0.40
        score = min(first.stress_avg_bps, second.stress_avg_bps) * math.sqrt(min(first.stress_trades, second.stress_trades) / 100) * min(first.stress_pf, second.stress_pf, 3) if eligible else -1e9
        selection_rows.append({"config": cfg.name, "eligible": eligible, "score": score, "avg20_2024": first.stress_avg_bps, "pf20_2024": first.stress_pf, "trades_2024": first.stress_trades, "breadth_2024": first.stress_breadth, "avg20_2025H1": second.stress_avg_bps, "pf20_2025H1": second.stress_pf, "trades_2025H1": second.stress_trades, "breadth_2025H1": second.stress_breadth})
    selection = pd.DataFrame(selection_rows).sort_values(["eligible", "score", "avg20_2025H1"], ascending=[False, False, False]); selection.to_csv(output / "SELECTION_BEFORE_2025H2.csv", index=False)
    chosen_name = str(selection.iloc[0].config); chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)
    chosen_parts = []; factual_rows = []
    for label in periods:
        part = stores[(chosen_name, label)].copy()
        if len(part): part["period"] = label; chosen_parts.append(part)
        factual_rows.append({"period": label, **{f"base_{key}": value for key, value in metrics(part, BASE_COST).items()}, **{f"stress_{key}": value for key, value in metrics(part, STRESS_COST).items()}})
    chosen_frame = pd.concat(chosen_parts, ignore_index=True) if chosen_parts else pd.DataFrame(); chosen_frame.to_csv(output / "CHOSEN_TRADES.csv", index=False)
    factual = pd.DataFrame(factual_rows); factual.to_csv(output / "FACTUAL_RESULTS.csv", index=False)
    accounts = []
    for label, bounds in {"full": (START, END), "forward_after_selection": (CUT2, END), "fresh_2026": (CUT3, END)}.items():
        for risk in (0.5, 1.0, 2.0, 3.0): accounts.append({"sample": label, **account(chosen_frame, risk, STRESS_COST, *bounds)})
    account_frame = pd.DataFrame(accounts); account_frame.to_csv(output / "ACCOUNT_SCENARIOS.csv", index=False)
    summary = {"generated_at": datetime.now(UTC).isoformat(), "configs": len(CONFIGS), "eligible_configs": int(selection.eligible.sum()), "chosen": asdict(chosen), "selection": selection.head(20).to_dict(orient="records"), "factual": factual_rows, "accounts": accounts}
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str)); (output / "REPORT_RU.md").write_text("# Round 45 — breakout resolution\n\n## Selection before 2025 H2\n\n" + selection.head(30).to_markdown(index=False, floatfmt=".3f") + "\n\n## Factual periods\n\n" + factual.to_markdown(index=False, floatfmt=".3f") + "\n\n## Accounts at 20 bps\n\n" + account_frame.to_markdown(index=False, floatfmt=".3f") + "\n")
    print(json.dumps(summary, indent=2, default=str))

if __name__ == "__main__": main()
