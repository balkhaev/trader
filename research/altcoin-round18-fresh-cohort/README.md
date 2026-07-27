# Round 18 — fresh July cohort

Фиксированная проверка девяти маршрутов `coin × exact variant`, которых не было в предыдущих июльских таблицах.

## Маршруты, зафиксированные до чтения июля

| Symbol | Variant |
|---|---|
| PENDLEUSDT | LONG60 |
| TONUSDT | LONG45_TIGHT |
| ZECUSDT | LONG45_WIDE |
| TRUMPUSDT | LONG45_TIGHT |
| ATOMUSDT | LONG60 |
| CFXUSDT | LONG45_WIDE |
| JUPUSDT | LONG45_TIGHT |
| ORDIUSDT | LONG45_TIGHT |
| WLDUSDT | SHORT45_CONTROL |

Отбор выполнен только по метрикам 2025 H2 и 2026 H1 из Round 17. Для каждой монеты оставлен один общий flow-exhaustion маршрут. Июль 2026 не использовался для выбора этих девяти строк.

## Исполнение

- 15m сигнал, вход на следующем open;
- одна позиция на монету;
- overnight запрещён;
- стоп и цель задаются фиксированным variant;
- позиции, пересекающие фактическое funding-событие, пропускаются;
- 12 bps base, 20 bps stress;
- official Binance USD-M ZIP + соседний SHA-256 `.CHECKSUM`.
