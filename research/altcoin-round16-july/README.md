# Round 16 — fresh July 2026 altcoin check

Фиксированная forward-проверка шести кандидатов Round 15: OPUSDT, TIAUSDT, ETCUSDT, LINKUSDT, INJUSDT и SUIUSDT.

- Правило FLOW_EXHAUST_45M и исполнение не меняются.
- Период: 2026-07-01 — 2026-07-26 включительно.
- Данные: official Binance USD-M daily 15m klines; каждый ZIP сверяется с `.CHECKSUM`.
- Для прогрева признаков используется checksum-verified monthly archive за июнь 2026.
- Funding timestamps загружаются из публичного USD-M endpoint, а сырые ответы и SHA-256 сохраняются в artifact.
- Вход на следующем 15m open, одна позиция на контракт, no overnight, сделки через funding-event запрещены.
- Полный оборот: 12 bps; стресс: 20 bps.

Это не новый поиск параметров. Цель — проверить уже выбранные до июля монеты на действительно последующем календаре.
