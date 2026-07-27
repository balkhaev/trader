# Round 26 — open interest and positioning

Исследование другого экономического механизма: не только свечи, а изменения открытого интереса и позиционирования участников.

## Universe

15 наиболее ликвидных альткоин-перпетуалов из заранее зафиксированного universe: SOL, XRP, DOGE, BNB, SUI, PEPE, ADA, ENA, LINK, AVAX, LTC, ZEC, PENGU, BCH и WIF. BTC/ETH не участвуют.

## Данные

- official Binance USD-M 15m klines;
- daily native 5m `metrics`: OI, top-trader account/position ratios, all-account ratio, taker buy/sell ratio;
- fundingRate;
- каждый ZIP проверяется по соседнему SHA-256 `.CHECKSUM`.

## Механизмы

1. OI flush + price reclaim;
2. OI build continuation;
3. price/OI divergence;
4. retail crowding против top-trader positioning.

Всего 12 заранее ограниченных конфигураций. Выбор происходит только по отдельным результатам июля–декабря 2025 и января–июня 2026, включая 20 bps и breadth по монетам. Затем конфигурация неизменно проверяется 1–26 июля 2026.

Исполнение: signal after close, next 15m open, stop 1.5 ATR, target 2R, hold 45/60m, top-4 per timestamp, one position per symbol, no overnight, skip funding-crossing, 12/20 bps.
