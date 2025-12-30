# region imports
from AlgorithmImports import *
# endregion

class BinanceSMAv2(QCAlgorithm):
    """
    SMA Crossover v2 стратегия для BTCUSDT на Binance

    Улучшения v2:
    - RSI фильтр: не покупаем при перекупленности (RSI > 70), не продаём при перепроданности (RSI < 30)
    - Volume фильтр: торгуем только при объёме выше среднего
    - Stop Loss: автоматический стоп-лосс на заданный процент
    - Take Profit: автоматический тейк-профит на заданный процент
    """

    def initialize(self):
        self.set_start_date(2024, 1, 1)
        self.set_end_date(2024, 12, 1)
        self.set_cash(10000)

        # Настройка брокера Binance
        self.set_brokerage_model(BrokerageName.BINANCE, AccountType.MARGIN)

        # Добавляем BTCUSDT
        self.btc = self.add_crypto("BTCUSDT", Resolution.HOUR, Market.BINANCE)
        self.symbol = self.btc.symbol

        # === Параметры стратегии (читаем из config.json или CLI) ===
        self.fast_period = int(self.get_parameter("fast_period", 10))
        self.slow_period = int(self.get_parameter("slow_period", 30))
        self.rsi_period = int(self.get_parameter("rsi_period", 14))
        self.volume_period = int(self.get_parameter("volume_period", 20))
        self.rsi_overbought = int(self.get_parameter("rsi_overbought", 70))
        self.rsi_oversold = int(self.get_parameter("rsi_oversold", 30))
        self.stop_loss_pct = float(self.get_parameter("stop_loss_pct", 0.03))
        self.take_profit_pct = float(self.get_parameter("take_profit_pct", 0.06))

        # === Индикаторы ===
        # SMA для тренда
        self.fast_sma = self.sma(self.symbol, self.fast_period, Resolution.HOUR)
        self.slow_sma = self.sma(self.symbol, self.slow_period, Resolution.HOUR)

        # RSI для фильтрации
        self.rsi_indicator = RelativeStrengthIndex(self.rsi_period, MovingAverageType.WILDERS)
        self.register_indicator(self.symbol, self.rsi_indicator, Resolution.HOUR)

        # SMA для объёма
        self.volume_sma = SimpleMovingAverage(self.volume_period)

        # Прогреваем индикаторы
        self.set_warm_up(max(self.slow_period, self.rsi_period, self.volume_period), Resolution.HOUR)

        # Состояние позиции
        self.entry_price = None
        self.stop_loss_price = None
        self.take_profit_price = None

    def on_data(self, data: Slice):
        # Пропускаем если индикаторы не готовы
        if self.is_warming_up:
            return

        if not self.fast_sma.is_ready or not self.slow_sma.is_ready or not self.rsi_indicator.is_ready:
            return

        # Проверяем наличие данных
        if not data.contains_key(self.symbol):
            return

        bar = data[self.symbol]
        price = bar.close
        volume = bar.volume

        # Обновляем SMA объёма
        self.volume_sma.update(self.time, volume)

        if not self.volume_sma.is_ready:
            return

        fast = self.fast_sma.current.value
        slow = self.slow_sma.current.value
        rsi = self.rsi_indicator.current.value
        avg_volume = self.volume_sma.current.value

        # Флаги условий
        is_invested = self.portfolio[self.symbol].invested
        sma_bullish = fast > slow
        sma_bearish = fast < slow
        volume_confirmed = volume > avg_volume
        rsi_not_overbought = rsi < self.rsi_overbought
        rsi_not_oversold = rsi > self.rsi_oversold

        # === Проверка Stop Loss / Take Profit ===
        if is_invested and self.entry_price is not None:
            # Stop Loss
            if price <= self.stop_loss_price:
                self.liquidate(self.symbol)
                self.log(f"STOP LOSS: Price={price:.2f}, Entry={self.entry_price:.2f}, Loss={((price/self.entry_price)-1)*100:.2f}%")
                self._reset_position()
                return

            # Take Profit
            if price >= self.take_profit_price:
                self.liquidate(self.symbol)
                self.log(f"TAKE PROFIT: Price={price:.2f}, Entry={self.entry_price:.2f}, Profit={((price/self.entry_price)-1)*100:.2f}%")
                self._reset_position()
                return

        # === Логика входа ===
        # Условия для покупки:
        # 1. Быстрая SMA выше медленной (бычий тренд)
        # 2. RSI не перекуплен (< 70)
        # 3. Объём выше среднего (подтверждение)
        if sma_bullish and rsi_not_overbought and volume_confirmed and not is_invested:
            self.set_holdings(self.symbol, 0.95)
            self.entry_price = price
            self.stop_loss_price = price * (1 - self.stop_loss_pct)
            self.take_profit_price = price * (1 + self.take_profit_pct)
            self.log(f"BUY: Price={price:.2f}, Fast={fast:.2f}, Slow={slow:.2f}, RSI={rsi:.1f}, Vol={volume:.0f}/{avg_volume:.0f}, SL={self.stop_loss_price:.2f}, TP={self.take_profit_price:.2f}")

        # === Логика выхода ===
        # Условия для продажи:
        # 1. Быстрая SMA ниже медленной (медвежий тренд)
        # 2. RSI не перепродан (> 30)
        elif sma_bearish and rsi_not_oversold and is_invested:
            profit_pct = ((price / self.entry_price) - 1) * 100 if self.entry_price else 0
            self.liquidate(self.symbol)
            self.log(f"SELL: Price={price:.2f}, Fast={fast:.2f}, Slow={slow:.2f}, RSI={rsi:.1f}, P&L={profit_pct:.2f}%")
            self._reset_position()

    def _reset_position(self):
        """Сбросить состояние позиции"""
        self.entry_price = None
        self.stop_loss_price = None
        self.take_profit_price = None
