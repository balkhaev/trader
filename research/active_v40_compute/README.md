# Active V40–V41 exact-8h flow and liquidity research

Compute-only sealed-final research on the fixed January-2021 USD-M perpetual universe.

- V40: volume/taker-flow confirmed breakout, momentum, persistent imbalance and trade impulses.
- V41: wick exhaustion, failed auctions, flow divergence and liquidity sweeps.
- quote volume, trade count and taker-buy quote are taken from completed Binance 8h bars;
- signal at completed 8h close, execution at the next 8h open;
- actual archived funding, fixed delisting penalty and 40/80/120/160/200 bps per-side costs;
- independent selection for V40 and V41 using only 2021–2025;
- January–June 2026 opened only after selection proof;
- standalone gates must pass before any integration with frozen V28.

This branch is compute-only and must not be merged into `balkhaev/trader`.
