# region imports
from AlgorithmImports import *
# endregion

import csv
import os
from datetime import timedelta


class WifSignalData(PythonData):
    """Precomputed WIF feature rows from the server research-compatible scanner."""

    def get_source(self, config, date, is_live):
        path = os.environ.get("WIF_SIGNAL_CSV", "data/wif_consensus_signals.csv")
        return SubscriptionDataSource(path, SubscriptionTransportMedium.LOCAL_FILE)

    def reader(self, config, line, date, is_live):
        if not line or line.startswith("timestamp"):
            return None
        row = next(csv.reader([line]))
        item = WifSignalData()
        item.symbol = config.symbol
        item.time = datetime.fromisoformat(row[0].replace("Z", "+00:00")).replace(tzinfo=None)
        item.end_time = item.time
        item.value = float(row[1])
        item.entry_price = float(row[1])
        item.atr = float(row[2])
        item.move45m_atr = float(row[3])
        item.volume_z = float(row[4])
        item.taker_imbalance = float(row[5])
        item.oi_z = float(row[6])
        item.premium_z = float(row[7])
        item.open = float(row[8])
        item.high = float(row[9])
        item.low = float(row[10])
        item.close = float(row[11])
        return item


class DotFundingData(PythonData):
    """Already-known DOT funding observations. No future funding is used."""

    def get_source(self, config, date, is_live):
        path = os.environ.get("DOT_FUNDING_CSV", "data/dot_known_funding.csv")
        return SubscriptionDataSource(path, SubscriptionTransportMedium.LOCAL_FILE)

    def reader(self, config, line, date, is_live):
        if not line or line.startswith("timestamp"):
            return None
        row = next(csv.reader([line]))
        item = DotFundingData()
        item.symbol = config.symbol
        item.time = datetime.fromisoformat(row[0].replace("Z", "+00:00")).replace(tzinfo=None)
        item.end_time = item.time
        item.value = float(row[2])
        item.funding_time = datetime.fromisoformat(row[1].replace("Z", "+00:00")).replace(tzinfo=None)
        item.funding_bps = float(row[2])
        item.entry_price = float(row[3])
        item.atr = float(row[4])
        return item


class ConsensusWifDotRiskAccelerator(QCAlgorithm):
    """Research/execution harness for Consensus WIF + DOT Risk Accelerator V1."""

    def initialize(self):
        start = self.get_parameter("start_date", "2024-01-01").split("-")
        end = self.get_parameter("end_date", "2026-07-01").split("-")
        self.set_start_date(*[int(value) for value in start])
        self.set_end_date(*[int(value) for value in end])
        self.set_cash(float(self.get_parameter("cash", 10000)))
        self.set_brokerage_model(BrokerageName.BINANCE, AccountType.MARGIN)

        self.wif = self.add_crypto("WIFUSDT", Resolution.MINUTE, Market.BINANCE).symbol
        self.dot = self.add_crypto("DOTUSDT", Resolution.MINUTE, Market.BINANCE).symbol
        self.wif_feed = self.add_data(WifSignalData, "WIF_CONSENSUS", Resolution.MINUTE).symbol
        self.dot_feed = self.add_data(DotFundingData, "DOT_FUNDING", Resolution.MINUTE).symbol

        self.base_wif_risk = float(self.get_parameter("base_wif_risk", 0.03))
        self.base_dot_risk = float(self.get_parameter("base_dot_risk", 0.05))
        self.boost_wif_risk = float(self.get_parameter("boost_wif_risk", 0.075))
        self.boost_dot_risk = float(self.get_parameter("boost_dot_risk", 0.10))
        self.boost_trigger = float(self.get_parameter("boost_trigger", 0.15))
        self.derisk_drawdown = float(self.get_parameter("derisk_drawdown", 0.08))
        self.hard_stop_drawdown = float(self.get_parameter("hard_stop_drawdown", 0.15))
        self.max_gross = float(self.get_parameter("max_gross", 3.0))

        self.initial_equity = float(self.portfolio.total_portfolio_value)
        self.high_water = self.initial_equity
        self.last_derisk_high_water = self.initial_equity
        self.risk_mode = "base"
        self.position_meta = {}

    def on_data(self, data: Slice):
        self._update_risk_mode()
        self._manage_positions(data)
        if self.risk_mode == "stopped":
            return

        if data.contains_key(self.wif_feed):
            self._evaluate_wif(data[self.wif_feed])
        if data.contains_key(self.dot_feed):
            self._evaluate_dot(data[self.dot_feed])

    def _update_risk_mode(self):
        equity = float(self.portfolio.total_portfolio_value)
        self.high_water = max(self.high_water, equity)
        drawdown = 1 - equity / self.high_water if self.high_water else 1
        profit = equity / self.initial_equity - 1 if self.initial_equity else 0

        if drawdown >= self.hard_stop_drawdown:
            self.risk_mode = "stopped"
            return
        if self.risk_mode == "boost" and drawdown >= self.derisk_drawdown:
            self.risk_mode = "base"
            self.last_derisk_high_water = self.high_water
            return
        if (
            self.risk_mode == "base"
            and profit >= self.boost_trigger
            and abs(equity - self.high_water) < 1e-8
            and equity >= self.last_derisk_high_water
        ):
            self.risk_mode = "boost"

    def _evaluate_wif(self, signal):
        weekday = signal.time.weekday()
        if weekday not in (1, 4, 6):
            return
        candle_range = signal.high - signal.low
        if candle_range <= 0:
            return
        lower_wick = min(signal.open, signal.close) - signal.low
        lower_wick_ratio = lower_wick / candle_range
        close_location = (signal.close - signal.low) / candle_range
        strength = abs(signal.move45m_atr) + max(-signal.oi_z, 0) / 2 + max(-signal.premium_z, 0) / 2
        passes = (
            signal.move45m_atr <= -2
            and signal.volume_z >= 1
            and lower_wick_ratio >= 0.5
            and close_location >= 0.6
            and signal.taker_imbalance >= -0.10
            and signal.oi_z <= -1
            and strength >= 3.5
        )
        if passes:
            self._enter(self.wif, "wif", signal.entry_price, signal.atr, 1.25, 5, 60)

    def _evaluate_dot(self, signal):
        weekday = signal.funding_time.weekday()
        thresholds = {0: -2.25, 1: -2.25, 4: -2.50, 5: -2.50, 6: -2.50}
        threshold = thresholds.get(weekday)
        if threshold is not None and signal.funding_bps <= threshold:
            self._enter(self.dot, "dot", signal.entry_price, signal.atr, 6, 2, 480)

    def _target_risk(self, module):
        if self.risk_mode == "boost":
            return self.boost_wif_risk if module == "wif" else self.boost_dot_risk
        return self.base_wif_risk if module == "wif" else self.base_dot_risk

    def _enter(self, symbol, module, entry_price, atr, stop_atr, target_r, hold_minutes):
        if self.portfolio[symbol].invested:
            return
        stop_distance = atr * stop_atr
        if entry_price <= 0 or stop_distance <= 0:
            return
        equity = float(self.portfolio.total_portfolio_value)
        risk = self._target_risk(module)
        requested = equity * risk / (stop_distance / entry_price)
        current_gross = sum(abs(float(holding.holdings_value)) for holding in self.portfolio.values if holding.invested)
        notional = min(requested, max(0, equity * self.max_gross - current_gross))
        if notional <= 0:
            return
        quantity = notional / entry_price
        self.market_order(symbol, quantity)
        self.position_meta[symbol] = {
            "stop": entry_price - stop_distance,
            "target": entry_price + stop_distance * target_r,
            "exit_at": self.time + timedelta(minutes=hold_minutes),
        }

    def _manage_positions(self, data):
        for symbol, meta in list(self.position_meta.items()):
            if not self.portfolio[symbol].invested:
                del self.position_meta[symbol]
                continue
            price = float(self.securities[symbol].price)
            if price <= meta["stop"] or price >= meta["target"] or self.time >= meta["exit_at"]:
                self.liquidate(symbol)
                del self.position_meta[symbol]
