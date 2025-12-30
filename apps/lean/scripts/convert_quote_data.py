#!/usr/bin/env python3
"""
Конвертирует quote данные из формата Unix timestamp (ms) в формат Lean.

Входной формат:  timestamp_ms,bidOpen,bidHigh,bidLow,bidClose,askOpen,askHigh,askLow,askClose
Выходной формат: yyyyMMdd HH:mm,bidOpen,bidHigh,bidLow,bidClose,askOpen,askHigh,askLow,askClose
"""

import sys
import os
import zipfile
from datetime import datetime
from pathlib import Path
import tempfile
import shutil

def convert_timestamp(ts_ms: int) -> str:
    """Конвертирует Unix timestamp (мс) в формат Lean yyyyMMdd HH:mm"""
    dt = datetime.utcfromtimestamp(ts_ms / 1000)
    return dt.strftime("%Y%m%d %H:%M")

def convert_line(line: str) -> str:
    """Конвертирует одну строку данных в формат Lean QuoteBar.

    Входной формат (8 колонок после timestamp):
    timestamp,bidOpen,bidHigh,bidLow,bidClose,askOpen,askHigh,askLow,askClose

    Выходной формат Lean (10 колонок после даты):
    date,bidOpen,bidHigh,bidLow,bidClose,bidSize,askOpen,askHigh,askLow,askClose,askSize
    """
    parts = line.strip().split(',')
    if len(parts) < 9:
        return None

    try:
        ts_ms = int(parts[0])
        lean_date = convert_timestamp(ts_ms)

        # parts[1:5] = bidOpen, bidHigh, bidLow, bidClose
        # parts[5:9] = askOpen, askHigh, askLow, askClose
        bid_data = parts[1:5]  # bidOpen, bidHigh, bidLow, bidClose
        ask_data = parts[5:9]  # askOpen, askHigh, askLow, askClose

        # Добавляем фиктивные объёмы (Lean требует bidSize и askSize)
        bid_size = "0"
        ask_size = "0"

        return f"{lean_date},{','.join(bid_data)},{bid_size},{','.join(ask_data)},{ask_size}"
    except (ValueError, IndexError) as e:
        print(f"Ошибка парсинга: {line[:50]}... - {e}", file=sys.stderr)
        return None

def convert_zip_file(input_path: Path, output_path: Path = None, backup: bool = True):
    """Конвертирует zip файл с quote данными"""
    if output_path is None:
        output_path = input_path

    print(f"Конвертирую: {input_path}")

    # Читаем данные из zip
    with zipfile.ZipFile(input_path, 'r') as zf:
        names = zf.namelist()
        if not names:
            print(f"  Пустой архив, пропускаю")
            return

        csv_name = names[0]
        with zf.open(csv_name) as f:
            lines = f.read().decode('utf-8').splitlines()

    # Проверяем, нужна ли конвертация
    if lines and not lines[0].split(',')[0].isdigit():
        print(f"  Уже в формате Lean, пропускаю")
        return

    # Конвертируем
    converted = []
    for line in lines:
        if line.strip():
            result = convert_line(line)
            if result:
                converted.append(result)

    if not converted:
        print(f"  Нет данных для конвертации")
        return

    # Бэкап оригинала
    if backup and input_path == output_path:
        backup_path = input_path.with_suffix('.zip.bak')
        shutil.copy2(input_path, backup_path)
        print(f"  Бэкап: {backup_path}")

    # Записываем результат
    with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as tmp:
        tmp.write('\n'.join(converted))
        tmp_path = tmp.name

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(tmp_path, csv_name)

    os.unlink(tmp_path)
    print(f"  Готово: {len(converted)} строк")

def main():
    if len(sys.argv) < 2:
        print("Использование: python convert_quote_data.py <path_to_zip_or_directory>")
        print("Примеры:")
        print("  python convert_quote_data.py btcusdt_quote.zip")
        print("  python convert_quote_data.py ./crypto/binance/daily/")
        sys.exit(1)

    path = Path(sys.argv[1])

    if path.is_file() and path.suffix == '.zip':
        convert_zip_file(path)
    elif path.is_dir():
        # Конвертируем все *_quote.zip файлы в директории
        quote_files = list(path.glob('**/*_quote.zip'))
        print(f"Найдено {len(quote_files)} quote файлов")
        for qf in quote_files:
            convert_zip_file(qf)
    else:
        print(f"Ошибка: {path} не существует или не является zip/директорией")
        sys.exit(1)

if __name__ == '__main__':
    main()
