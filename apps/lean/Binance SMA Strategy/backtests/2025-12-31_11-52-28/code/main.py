# region imports
from AlgorithmImports import *
# endregion

class BinanceSMACrossover(QCAlgorithm):
    """
    SMA Crossover стратегия для BTCUSDT на Binance
    Покупаем когда быстрая SMA пересекает медленную снизу вверх
    Продаем когда быстрая SMA пересекает медленную сверху вниз
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

        # Создаем индикаторы SMA
        self.fast_sma = self.sma(self.symbol, 10, Resolution.HOUR)
        self.slow_sma = self.sma(self.symbol, 30, Resolution.HOUR)

        # Прогреваем индикаторы
        self.set_warm_up(30, Resolution.HOUR)

        # Флаг для отслеживания позиции
        self.invested = False

    def on_data(self, data: Slice):
        # Пропускаем если индикаторы не готовы
        if self.is_warming_up:
            return

        if not self.fast_sma.is_ready or not self.slow_sma.is_ready:
            return

        # Проверяем наличие данных
        if not data.contains_key(self.symbol):
            return

        price = data[self.symbol].close
        fast = self.fast_sma.current.value
        slow = self.slow_sma.current.value

        # Логика входа: быстрая SMA выше медленной - покупаем
        if fast > slow and not self.invested:
            self.set_holdings(self.symbol, 0.95)  # 95% портфеля
            self.invested = True
            self.log(f"BUY: Price={price:.2f}, Fast SMA={fast:.2f}, Slow SMA={slow:.2f}")

        # Логика выхода: быстрая SMA ниже медленной - продаем
        elif fast < slow and self.invested:
            self.liquidate(self.symbol)
            self.invested = False
            self.log(f"SELL: Price={price:.2f}, Fast SMA={fast:.2f}, Slow SMA={slow:.2f}")
