# Round 27 — premium and funding

Исследуется perpetual-basis и реакция рынка на экстремальное funding по 20 ликвидным Binance USD-M альткоинам без BTC/ETH.

## Данные

- official 15m contract klines;
- official 15m premiumIndexKlines;
- official monthly fundingRate и публичный July funding endpoint;
- SHA-256 `.CHECKSUM` для архивов.

## Механизмы

1. Fade экстремального premium после разворота premium и price-reclaim;
2. premium momentum continuation;
3. fade сразу после экстремального funding;
4. divergence между funding и текущим premium.

Всего 14 заранее ограниченных конфигураций. Конфигурация обязана пройти отдельно July–December 2025 и January–June 2026, включая 20 bps и breadth по контрактам. Затем выполняется неизменённая проверка 1–26 July 2026.

Исполнение: signal after close, next 15m open, stop 1.5 ATR, target 2R, hold 45/60m, top-5 per timestamp, one position per symbol, no overnight, positions crossing funding are skipped, 12/20 bps.
