#!/usr/bin/env python3
"""
Скрипт для скачивания исторических данных с Binance API
и конвертации в формат Lean quote (для portfolio optimization)
"""
import urllib.request
import urllib.parse
import json
import csv
import zipfile
import os
import sys
from datetime import datetime, timedelta
from io import StringIO


def download_binance_klines(symbol: str, interval: str, start_date: str, end_date: str):
    """
    Скачивает klines (свечи) с Binance API
    """
    base_url = "https://api.binance.com/api/v3/klines"

    start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp() * 1000)
    end_ts = int(datetime.strptime(end_date, "%Y-%m-%d").timestamp() * 1000)

    all_data = []
    current_ts = start_ts

    while current_ts < end_ts:
        params = {
            "symbol": symbol,
            "interval": interval,
            "startTime": str(current_ts),
            "endTime": str(end_ts),
            "limit": "1000"
        }

        url = f"{base_url}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url) as response:
                data = json.loads(response.read().decode())
        except Exception as e:
            print(f"Error: {e}")
            break

        if not data:
            break

        all_data.extend(data)
        current_ts = data[-1][0] + 1
        print(f"Downloaded {len(all_data)} candles for {symbol}...")

    return all_data


def convert_to_lean_quote_format(data: list, symbol: str, output_dir: str):
    """
    Конвертирует данные в формат Lean quote и сохраняет в zip
    Формат quote: time,bid_open,bid_high,bid_low,bid_close,ask_open,ask_high,ask_low,ask_close
    Используем OHLC как bid, добавляем небольшой спред для ask
    """
    os.makedirs(output_dir, exist_ok=True)

    csv_data = StringIO()
    writer = csv.writer(csv_data)

    spread = 0.0001  # 0.01% spread

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
            open_price * (1 + spread), high_price * (1 + spread),
            low_price * (1 + spread), close_price * (1 + spread)  # ask
        ])

    # Сохраняем в zip
    zip_path = os.path.join(output_dir, f"{symbol.lower()}_quote.zip")
    csv_filename = f"{symbol.lower()}.csv"

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(csv_filename, csv_data.getvalue())

    print(f"Saved to {zip_path}")
    return zip_path


def download_symbols(symbols: list[str], interval: str, start_date: str, end_date: str, output_dir: str):
    """Скачивает данные для списка символов"""
    for symbol in symbols:
        print(f"\n{'='*50}")
        print(f"Downloading {symbol}...")
        data = download_binance_klines(symbol, interval, start_date, end_date)

        if data:
            print(f"Total candles: {len(data)}")
            convert_to_lean_quote_format(data, symbol, output_dir)
        else:
            print(f"No data for {symbol}")


def main():
    # Популярные криптовалютные пары для portfolio optimization
    symbols = [
        "BTCUSDT",
        "ETHUSDT",
        "BNBUSDT",
        "SOLUSDT",
        "XRPUSDT",
        "ADAUSDT",
        "DOGEUSDT",
        "AVAXUSDT",
        "DOTUSDT",
        "LINKUSDT",
    ]

    # Можно передать символы через командную строку
    if len(sys.argv) > 1:
        symbols = sys.argv[1:]

    interval = "1d"  # daily
    start_date = "2023-01-01"
    end_date = datetime.now().strftime("%Y-%m-%d")
    output_dir = "data/crypto/binance/daily"

    print(f"Downloading {len(symbols)} symbols...")
    print(f"Period: {start_date} to {end_date}")
    print(f"Interval: {interval}")
    print(f"Output: {output_dir}")

    download_symbols(symbols, interval, start_date, end_date, output_dir)
    print("\n✓ Done!")


if __name__ == "__main__":
    main()
