# Round 30 — historical robustness

Backward robustness check for the frozen capital-sprint candidate:

- ETCUSDT core: every `FLOW_OI_STRICT60` signal;
- A-tier: `strength >= 5` on ETCUSDT, SOLUSDT and INJUSDT;
- 15m next-bar execution;
- stop 1.25 ATR, target 3R, maximum hold 60 minutes;
- maximum two simultaneous positions;
- no overnight and no funding-crossing positions;
- 12 bps base, 20 bps stress.

The rule was fixed after the July 2026 research. This workflow applies it unchanged to January 2024 through June 2025. The test is backward rather than chronological forward validation, so it is evidence of portability, not a live-ready approval.
