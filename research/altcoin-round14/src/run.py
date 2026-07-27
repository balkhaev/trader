from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from backtest import Exec, executions, metrics, rules, score, signal, simulate
from config import COST_BPS, PERIODS, STRESS_COST_BPS, SYMBOLS
from data import active_symbols, download_all, load_funding_events, load_symbol
from features import build


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite(value: object) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if np.isfinite(number) else None
    return value  # type: ignore[return-value]


def portfolio(
    routes: pd.DataFrame,
    trade_store: dict[tuple[str, str, str], list[dict[str, object]]],
    capital: float = 10_000,
    max_positions: int = 5,
    fraction: float = 0.10,
    extra_cost_bps: float = 0.0,
) -> tuple[dict[str, float | int], pd.DataFrame, pd.DataFrame]:
    all_trades: list[dict[str, object]] = []
    for _, route in routes.iterrows():
        for trade in trade_store.get((route.family, route.symbol, "2026H1"), []):
            adjusted = dict(trade)
            adjusted["net_bps"] = float(adjusted["net_bps"]) - extra_cost_bps
            all_trades.append(adjusted)
    entries: dict[pd.Timestamp, list[dict[str, object]]] = {}
    exits: dict[pd.Timestamp, list[dict[str, object]]] = {}
    for trade in all_trades:
        entries.setdefault(trade["entry_time"], []).append(trade)  # type: ignore[arg-type]
        exits.setdefault(trade["exit_time"], []).append(trade)  # type: ignore[arg-type]
    equity = float(capital)
    open_positions: dict[tuple[str, pd.Timestamp], float] = {}
    accepted: list[dict[str, object]] = []
    curve: list[dict[str, object]] = []
    for timestamp in sorted(set(entries) | set(exits)):
        # Exits occur before possible entries at the same bar open.
        for trade in exits.get(timestamp, []):
            key = (str(trade["symbol"]), trade["entry_time"])  # type: ignore[arg-type]
            if key in open_positions:
                notional = open_positions.pop(key)
                pnl = notional * float(trade["net_bps"]) / 1e4
                equity += pnl
                accepted.append(
                    trade
                    | {
                        "notional": notional,
                        "pnl_usd": pnl,
                        "equity_after": equity,
                    }
                )
        for trade in sorted(
            entries.get(timestamp, []),
            key=lambda item: float(item["strength"]),
            reverse=True,
        ):
            if len(open_positions) >= max_positions:
                continue
            if any(key[0] == str(trade["symbol"]) for key in open_positions):
                continue
            open_positions[(str(trade["symbol"]), trade["entry_time"])] = equity * fraction  # type: ignore[arg-type]
        curve.append(
            {"time": timestamp, "equity": equity, "open_positions": len(open_positions)}
        )
    curve_frame = pd.DataFrame(curve)
    trade_frame = pd.DataFrame(accepted)
    days = (PERIODS["2026H1"][1] - PERIODS["2026H1"][0]).days
    if curve_frame.empty:
        return {}, trade_frame, curve_frame
    drawdown = curve_frame.equity / curve_frame.equity.cummax() - 1
    period_return = equity / capital - 1
    result: dict[str, float | int] = {
        "start_usd": float(capital),
        "end_usd": float(equity),
        "pnl_usd": float(equity - capital),
        "return_pct": float(period_return * 100),
        "annualized_pct": float(((equity / capital) ** (365 / days) - 1) * 100),
        "closed_dd_pct": float(-drawdown.min() * 100),
        "trades": int(len(trade_frame)),
        "trades_per_day": float(len(trade_frame) / days),
        "max_positions": int(max_positions),
        "notional_per_position_pct": float(fraction * 100),
        "assumed_round_turn_cost_bps": float(COST_BPS + extra_cost_bps),
    }
    return result, trade_frame, curve_frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = download_all(SYMBOLS, cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)
    active = active_symbols()
    features: dict[str, pd.DataFrame] = {}
    funding: dict[str, np.ndarray] = {}
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        raw = load_symbol(symbol, manifest)
        events = load_funding_events(symbol, manifest)
        current_slice = raw[
            (raw.open_time >= PERIODS["2026H1"][0])
            & (raw.open_time < PERIODS["2026H1"][1])
        ]
        daily_quote_volume = (
            0.0
            if current_slice.empty
            else float(
                current_slice.set_index("open_time")
                .quote_volume.resample("1D")
                .sum().median()
            )
        )
        coverage.append(
            {
                "symbol": symbol,
                "rows": int(len(raw)),
                "first": None if raw.empty else raw.open_time.iloc[0],
                "last": None if raw.empty else raw.open_time.iloc[-1],
                "active_now": active.get(symbol),
                "median_daily_quote_volume_2026": daily_quote_volume,
                "funding_events": int(len(events)),
            }
        )
        if not raw.empty:
            features[symbol] = build(raw)
            funding[symbol] = events.astype("int64").to_numpy()
        print(symbol, len(raw), "funding", len(events))
    coverage_frame = pd.DataFrame(coverage)
    coverage_frame.to_csv(output / "UNIVERSE_COVERAGE.csv", index=False)

    rule_grid: list[dict[str, object]] = []
    candidate_rules = rules()
    fixed_execution = Exec(passive=False, offset=0.0, hold=12, stop=None, target=None)
    top_rules: dict[str, list] = {}
    for index, rule in enumerate(candidate_rules, 1):
        trades: list[dict[str, object]] = []
        for symbol, frame in features.items():
            trades += simulate(
                symbol,
                frame,
                rule,
                fixed_execution,
                *PERIODS["2024"],
                funding_ns=funding[symbol],
            )
        ranking, result = score(trades)
        rule_grid.append(
            {
                "family": rule.family,
                "rule_id": rule.rule_id,
                "params": json.dumps(rule.params, sort_keys=True),
                "score": ranking,
            }
            | result
        )
        if index % 25 == 0:
            print("rules", index, len(candidate_rules))
    rule_grid_frame = pd.DataFrame(rule_grid).sort_values("score", ascending=False)
    rule_grid_frame.to_csv(output / "SEARCH_GRID_2024.csv", index=False)
    rule_map = {rule.rule_id: rule for rule in candidate_rules}
    for family, group in rule_grid_frame.groupby("family"):
        top_rules[family] = [rule_map[rule_id] for rule_id in group.head(2).rule_id]

    execution_grid: list[dict[str, object]] = []
    frozen: dict[str, tuple] = {}
    for family, family_rules in top_rules.items():
        for rule in family_rules:
            precomputed = {symbol: signal(frame, rule) for symbol, frame in features.items()}
            for execution in executions():
                trades: list[dict[str, object]] = []
                for symbol, frame in features.items():
                    trades += simulate(
                        symbol,
                        frame,
                        rule,
                        execution,
                        *PERIODS["2024"],
                        funding_ns=funding[symbol],
                        pre=precomputed[symbol],
                    )
                ranking, result = score(trades, min_trades=150)
                execution_grid.append(
                    {
                        "family": family,
                        "rule_id": rule.rule_id,
                        "params": json.dumps(rule.params, sort_keys=True),
                        "execution": json.dumps(asdict(execution), sort_keys=True),
                        "score": ranking,
                    }
                    | result
                )
    execution_grid_frame = pd.DataFrame(execution_grid).sort_values("score", ascending=False)
    execution_grid_frame.to_csv(output / "EXECUTION_GRID_2024.csv", index=False)
    for family, group in execution_grid_frame.groupby("family"):
        selected = group.iloc[0]
        frozen[family] = (
            rule_map[selected.rule_id],
            Exec(**json.loads(selected.execution)),
        )
    (output / "FROZEN_RULES.json").write_text(
        json.dumps(
            {
                family: {"rule": asdict(value[0]), "execution": asdict(value[1])}
                for family, value in frozen.items()
            },
            indent=2,
        )
    )

    family_rows: list[dict[str, object]] = []
    coin_rows: list[dict[str, object]] = []
    trade_store: dict[tuple[str, str, str], list[dict[str, object]]] = {}
    for family, (rule, execution) in frozen.items():
        for period, bounds in PERIODS.items():
            all_trades: list[dict[str, object]] = []
            for symbol, frame in features.items():
                trades = simulate(
                    symbol,
                    frame,
                    rule,
                    execution,
                    *bounds,
                    funding_ns=funding[symbol],
                )
                trade_store[(family, symbol, period)] = trades
                all_trades += trades
                result = metrics(trades)
                stress_average = (
                    float(np.mean([trade["net_bps"] - (STRESS_COST_BPS - COST_BPS) for trade in trades]))
                    if trades
                    else float("nan")
                )
                coin_rows.append(
                    {"family": family, "symbol": symbol, "period": period}
                    | result
                    | {"avg_bps_at_20bps": stress_average}
                )
            family_rows.append({"family": family, "period": period} | metrics(all_trades))
    coin_metrics = pd.DataFrame(coin_rows)
    family_metrics = pd.DataFrame(family_rows)
    coin_metrics.to_csv(output / "ALL_COIN_RESULTS.csv", index=False)
    family_metrics.to_csv(output / "FAMILY_RESULTS.csv", index=False)

    coverage_by_symbol = coverage_frame.set_index("symbol")
    route_rows: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        if symbol not in coverage_by_symbol.index:
            continue
        item = coverage_by_symbol.loc[symbol]
        if float(item.median_daily_quote_volume_2026) < 25e6:
            continue
        if pd.notna(item.active_now) and not bool(item.active_now):
            continue
        options: list[tuple] = []
        for family in frozen:
            first = coin_metrics[
                (coin_metrics.symbol == symbol)
                & (coin_metrics.family == family)
                & (coin_metrics.period == "2024")
            ]
            second = coin_metrics[
                (coin_metrics.symbol == symbol)
                & (coin_metrics.family == family)
                & (coin_metrics.period == "2025")
            ]
            if first.empty or second.empty:
                continue
            first_row = first.iloc[0]
            second_row = second.iloc[0]
            if (
                first_row.trades >= 15
                and second_row.trades >= 20
                and first_row.avg_bps > 0
                and second_row.avg_bps > 0
                and second_row.pf > 1.05
            ):
                selection_score = (
                    min(first_row.avg_bps, second_row.avg_bps)
                    * math.sqrt(second_row.trades)
                    * min(second_row.pf, 3)
                )
                options.append((selection_score, family, first_row, second_row))
        if options:
            selection_score, family, first_row, second_row = max(options)
            route_rows.append(
                {
                    "symbol": symbol,
                    "family": family,
                    "selection_score": float(selection_score),
                    "trades_2024": int(first_row.trades),
                    "avg_bps_2024": float(first_row.avg_bps),
                    "trades_2025": int(second_row.trades),
                    "avg_bps_2025": float(second_row.avg_bps),
                    "pf_2025": float(second_row.pf),
                }
            )
    routes = (
        pd.DataFrame(route_rows).sort_values("selection_score", ascending=False).head(12)
        if route_rows
        else pd.DataFrame()
    )
    routes.to_csv(output / "ROUTES_FIXED_BEFORE_2026.csv", index=False)

    current_rows: list[dict[str, object]] = []
    selected_route_trades: list[dict[str, object]] = []
    for _, route in routes.iterrows():
        current = coin_metrics[
            (coin_metrics.symbol == route.symbol)
            & (coin_metrics.family == route.family)
            & (coin_metrics.period == "2026H1")
        ].iloc[0]
        selected_route_trades += trade_store.get((route.family, route.symbol, "2026H1"), [])
        current_rows.append(
            route.to_dict()
            | {
                "trades_2026H1": int(current.trades),
                "avg_bps_2026H1": float(current.avg_bps),
                "pf_2026H1": float(current.pf),
                "avg_bps_2026H1_at_20bps": float(current.avg_bps_at_20bps),
                "robust_current": bool(
                    current.trades >= 15
                    and current.avg_bps > 0
                    and current.pf > 1.05
                    and current.avg_bps_at_20bps > 0
                ),
            }
        )
    current_candidates = (
        pd.DataFrame(current_rows).sort_values(
            ["robust_current", "avg_bps_2026H1"], ascending=[False, False]
        )
        if current_rows
        else pd.DataFrame()
    )
    current_candidates.to_csv(output / "CURRENT_CANDIDATES_2026H1.csv", index=False)
    pd.DataFrame(selected_route_trades).to_csv(output / "SELECTED_ROUTE_TRADES_2026H1.csv", index=False)

    all_current = coin_metrics[coin_metrics.period == "2026H1"].copy()
    all_current = all_current.merge(
        coverage_frame[["symbol", "median_daily_quote_volume_2026", "active_now"]],
        on="symbol",
        how="left",
    ).sort_values(["avg_bps_at_20bps", "pf"], ascending=False)
    all_current.to_csv(output / "ALL_CURRENT_RANKING_2026H1.csv", index=False)

    portfolio_base, portfolio_trades, portfolio_equity = portfolio(routes, trade_store)
    portfolio_stress, _, _ = portfolio(
        routes,
        trade_store,
        extra_cost_bps=STRESS_COST_BPS - COST_BPS,
    )
    portfolio_trades.to_csv(output / "PORTFOLIO_TRADES_2026H1.csv", index=False)
    portfolio_equity.to_csv(output / "PORTFOLIO_EQUITY_2026H1.csv", index=False)
    (output / "PORTFOLIO_METRICS.json").write_text(
        json.dumps({"base_12bps": portfolio_base, "stress_20bps": portfolio_stress}, indent=2)
    )

    table = (
        "нет кандидатов"
        if current_candidates.empty
        else current_candidates.to_markdown(index=False, floatfmt=".2f")
    )
    report = f"""# Round 14 — широкий альткоин-universe

Проверено {len(SYMBOLS)} заранее зафиксированных USD-M контрактов на официальных 5m архивах Binance с SHA-256-проверкой. BTC и ETH в список кандидатов не включались.

Пять общих механизмов: taker-flow impulse, squeeze breakout, sweep/reclaim, flow exhaustion и trend pullback. Правила и исполнение выбраны только по 2024 году. Маршрут «монета × механизм» фиксируется по данным не позднее 31 декабря 2025 года. Таблица ниже — неизменённый результат за 1 января — 30 июня 2026 года.

Позиции, пересекающие фактическое funding-событие из официального архива fundingRate, не открываются. Базовые полные издержки — 12 bps, стресс — 20 bps.

## Кандидаты 2026 H1

{table}

## Портфель $10 000, максимум пять позиций по 10% капитала

```json
{json.dumps({"base_12bps": portfolio_base, "stress_20bps": portfolio_stress}, indent=2)}
```

`annualized_pct` — механическая экстраполяция шести месяцев, не прогноз. `closed_dd_pct` — просадка по закрытому equity, не полноценная внутрисделочная MTM-просадка.

## Ограничения

- современный fixed universe создаёт survivorship bias;
- 5m OHLCV не восстанавливает реальную очередь passive order;
- единая стоимость не заменяет fee tier аккаунта;
- исключение funding-событий уменьшает выборку и является частью правила;
- исторический плюс не гарантирует будущий результат.
"""
    (output / "REPORT_RU.md").write_text(report)
    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols_requested": len(SYMBOLS),
        "symbols_with_data": len(features),
        "signal_rules": len(candidate_rules),
        "execution_rows": len(execution_grid_frame),
        "routes_fixed_before_2026": len(routes),
        "robust_candidates_2026H1": int(current_candidates.robust_current.sum())
        if not current_candidates.empty
        else 0,
        "portfolio": {"base_12bps": portfolio_base, "stress_20bps": portfolio_stress},
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2))
    checksum_lines: list[str] = []
    for path in sorted(output.iterdir()):
        if path.is_file() and path.name != "SHA256SUMS.txt":
            checksum_lines.append(f"{sha256(path)}  {path.name}")
    (output / "SHA256SUMS.txt").write_text("\n".join(checksum_lines) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
