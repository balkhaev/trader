from __future__ import annotations

V8_OVERLAY_SCALE = 0.40
V7_HEDGE_COMPONENTS = (
    {"kind":"carry_bear","max_size":0.30,"ema_days":100,"mom_days":252,"vol_days":90,"target_vol":0.10,"every":14},
    {"kind":"dual","max_size":0.40,"ema_days":100,"mom_days":252,"vol_days":90,"target_vol":0.10,"every":14},
    {"kind":"carry_bear","max_size":0.40,"ema_days":100,"mom_days":252,"vol_days":60,"target_vol":0.10,"every":14},
)
V8_COMPONENTS = (
    {"lookback_days":126,"threshold":0.05,"vol_days":60,"target_vol":0.20,"max_gross":0.75,"rebalance_days":7},
    {"lookback_days":90,"threshold":0.15,"vol_days":30,"target_vol":0.10,"max_gross":1.00,"rebalance_days":28},
    {"lookback_days":90,"threshold":0.15,"vol_days":60,"target_vol":0.10,"max_gross":1.00,"rebalance_days":28},
)
