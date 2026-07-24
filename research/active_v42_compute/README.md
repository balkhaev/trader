# Active V42–V43 BTC open-interest and crowding research

Compute-only sealed-final research using official Binance daily futures metrics archives.

- V42: OI-confirmed trend/breakout, deleveraging reversal and price/OI divergence.
- V43: retail crowding contrarian, top-vs-retail divergence, crowding trend and crowding reversal.
- BTCUSDT only: daily metrics coverage is confirmed from 2020-09, avoiding mixed-history survivorship bias.
- Native 5-minute metrics are aggregated causally to completed 8-hour snapshots.
- Exact 8-hour price bars and archived funding; signal at completed close, execution at next 8h open.
- Costs 40/80/120/160/200 bps per side, gross cap 0.35 and forced-exit penalty.
- Independent selection on 2021–2025; January–June 2026 opens only after proof.

This branch is compute-only and must not be merged into `balkhaev/trader`.
