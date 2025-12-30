"""
Data Manager для управления историческими данными криптовалют.
Автоматическая загрузка, обновление и мониторинг данных.
"""

import csv
import json
import os
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path


@dataclass
class SymbolStatus:
    """Статус символа в хранилище данных"""
    symbol: str
    available: bool
    file_path: str | None = None
    file_size: int = 0
    candles_count: int = 0
    start_date: str | None = None
    end_date: str | None = None
    last_updated: str | None = None


class DataManager:
    """Менеджер данных для Lean и Portfolio Optimization"""

    DEFAULT_START_DATE = "2023-01-01"
    SPREAD = 0.0001  # 0.01% спред для bid/ask

    def __init__(self, lean_path: str):
        self.lean_path = Path(lean_path)
        self.data_path = self.lean_path / "data" / "crypto" / "binance" / "daily"
        self.data_path.mkdir(parents=True, exist_ok=True)

    def get_available_symbols(self) -> list[str]:
        """Получить список всех доступных символов"""
        symbols = []
        for f in self.data_path.glob("*_quote.zip"):
            symbol = f.stem.replace("_quote", "").upper()
            symbols.append(symbol)
        return sorted(symbols)

    def is_symbol_available(self, symbol: str) -> bool:
        """Проверить доступность символа"""
        zip_file = self.data_path / f"{symbol.lower()}_quote.zip"
        return zip_file.exists()

    def get_symbol_status(self, symbol: str) -> SymbolStatus:
        """Получить детальный статус символа"""
        zip_file = self.data_path / f"{symbol.lower()}_quote.zip"

        if not zip_file.exists():
            return SymbolStatus(
                symbol=symbol.upper(),
                available=False,
            )

        # Читаем данные из zip для получения статистики
        try:
            candles_count = 0
            start_date = None
            end_date = None

            with zipfile.ZipFile(zip_file, 'r') as zf:
                csv_name = zf.namelist()[0]
                with zf.open(csv_name) as f:
                    content = f.read().decode('utf-8')
                    lines = content.strip().split('\n')
                    candles_count = len(lines)

                    if lines:
                        # Первая свеча
                        first_ts = int(lines[0].split(',')[0])
                        start_date = datetime.fromtimestamp(first_ts / 1000).strftime("%Y-%m-%d")

                        # Последняя свеча
                        last_ts = int(lines[-1].split(',')[0])
                        end_date = datetime.fromtimestamp(last_ts / 1000).strftime("%Y-%m-%d")

            file_stat = zip_file.stat()

            return SymbolStatus(
                symbol=symbol.upper(),
                available=True,
                file_path=str(zip_file),
                file_size=file_stat.st_size,
                candles_count=candles_count,
                start_date=start_date,
                end_date=end_date,
                last_updated=datetime.fromtimestamp(file_stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
            )
        except Exception as e:
            return SymbolStatus(
                symbol=symbol.upper(),
                available=False,
            )

    def get_all_status(self) -> list[SymbolStatus]:
        """Получить статус всех доступных символов"""
        symbols = self.get_available_symbols()
        return [self.get_symbol_status(s) for s in symbols]

    def check_symbols(self, symbols: list[str]) -> dict[str, list[str]]:
        """Проверить какие символы доступны, какие нет"""
        available = []
        missing = []

        for symbol in symbols:
            if self.is_symbol_available(symbol):
                available.append(symbol.upper())
            else:
                missing.append(symbol.upper())

        return {"available": available, "missing": missing}

    def _download_binance_klines(
        self,
        symbol: str,
        interval: str,
        start_date: str,
        end_date: str
    ) -> list:
        """Скачать свечи с Binance API"""
        base_url = "https://api.binance.com/api/v3/klines"

        start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp() * 1000)
        end_ts = int(datetime.strptime(end_date, "%Y-%m-%d").timestamp() * 1000)

        all_data = []
        current_ts = start_ts

        while current_ts < end_ts:
            params = {
                "symbol": symbol.upper(),
                "interval": interval,
                "startTime": str(current_ts),
                "endTime": str(end_ts),
                "limit": "1000"
            }

            url = f"{base_url}?{urllib.parse.urlencode(params)}"

            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    data = json.loads(response.read().decode())
            except Exception as e:
                print(f"Error downloading {symbol}: {e}")
                break

            if not data:
                break

            all_data.extend(data)
            current_ts = data[-1][0] + 1

        return all_data

    def _save_to_lean_format(self, data: list, symbol: str) -> str | None:
        """Сохранить данные в формате Lean quote"""
        if not data:
            return None

        csv_data = StringIO()
        writer = csv.writer(csv_data)

        for candle in data:
            timestamp_ms = candle[0]
            open_price = float(candle[1])
            high_price = float(candle[2])
            low_price = float(candle[3])
            close_price = float(candle[4])

            # bid = price, ask = price * (1 + spread)
            writer.writerow([
                timestamp_ms,
                open_price, high_price, low_price, close_price,  # bid
                open_price * (1 + self.SPREAD),
                high_price * (1 + self.SPREAD),
                low_price * (1 + self.SPREAD),
                close_price * (1 + self.SPREAD)  # ask
            ])

        # Сохраняем в zip
        zip_path = self.data_path / f"{symbol.lower()}_quote.zip"
        csv_filename = f"{symbol.lower()}.csv"

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(csv_filename, csv_data.getvalue())

        return str(zip_path)

    def download_symbol(
        self,
        symbol: str,
        start_date: str | None = None,
        end_date: str | None = None
    ) -> SymbolStatus:
        """Скачать данные для одного символа"""
        if start_date is None:
            start_date = self.DEFAULT_START_DATE
        if end_date is None:
            end_date = datetime.now().strftime("%Y-%m-%d")

        print(f"Downloading {symbol} from {start_date} to {end_date}...")

        data = self._download_binance_klines(symbol, "1d", start_date, end_date)

        if data:
            self._save_to_lean_format(data, symbol)
            print(f"Downloaded {len(data)} candles for {symbol}")
        else:
            print(f"No data for {symbol}")

        return self.get_symbol_status(symbol)

    def download_missing(self, symbols: list[str]) -> list[SymbolStatus]:
        """Скачать недостающие символы"""
        results = []
        check = self.check_symbols(symbols)

        for symbol in check["missing"]:
            status = self.download_symbol(symbol)
            results.append(status)

        return results

    def update_symbol(self, symbol: str) -> SymbolStatus:
        """Обновить данные символа до текущей даты"""
        status = self.get_symbol_status(symbol)

        if status.available and status.end_date:
            # Начинаем с последней даты
            start_date = status.end_date
        else:
            start_date = self.DEFAULT_START_DATE

        return self.download_symbol(symbol, start_date=start_date)

    def update_all(self) -> list[SymbolStatus]:
        """Обновить все доступные символы"""
        symbols = self.get_available_symbols()
        results = []

        for symbol in symbols:
            status = self.update_symbol(symbol)
            results.append(status)

        return results

    def ensure_symbols(self, symbols: list[str]) -> dict[str, list[str]]:
        """
        Убедиться что все символы доступны.
        Автоматически скачивает недостающие.
        Возвращает финальный статус.
        """
        check = self.check_symbols(symbols)

        if check["missing"]:
            print(f"Downloading missing symbols: {check['missing']}")
            self.download_missing(check["missing"])

        # Повторная проверка
        return self.check_symbols(symbols)
