#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent
MANIFEST=json.loads((ROOT/'selection_manifest.json').read_text(encoding='utf-8'))
def separate_accounts(v8,v4,w8,w4):
    if v8.shape!=v4.shape: raise ValueError('shape mismatch')
    if min(w8,w4)<0 or not np.isclose(w8+w4,1): raise ValueError('invalid weights')
    return w8*np.cumprod(1+v8)+w4*np.cumprod(1+v4)
def main():
    c=MANIFEST['construction'];s=MANIFEST['selection'];h=MANIFEST['headline_checks']
    assert MANIFEST['candidate_id']=='V10_SEPARATE_ACCOUNTS_V8_80_V4_20'
    assert MANIFEST['status']=='frozen_paper_forward_candidate'
    assert c['accounts_are_separate'] and c['capital_is_not_rebalanced_between_sleeves']
    assert not c['leverage'] and np.isclose(c['v8_growth_weight'],.8) and np.isclose(c['v4_defensive_weight'],.2)
    assert s['selection_end_exclusive']<=s['final_start'] and not s['final_used_for_selection']
    assert s['candidate_v4_weights']==[.2,.3,.4,.5] and s['costs_bps_per_side']==[40,80]
    assert h['stress_v10_max_drawdown']-h['stress_v8_max_drawdown']>=.02
    assert h['severe_v10_max_drawdown']-h['severe_v8_max_drawdown']>=.02
    assert abs(h['stress_v10_sharpe']-h['stress_v8_sharpe'])<=.01
    assert h['paired_bootstrap_probability_v10_lower_drawdown_min']>=.90
    rng=np.random.default_rng(20260724);v8=rng.normal(.0006,.022,800);v4=rng.normal(.00025,.008,800)
    eq=separate_accounts(v8,v4,.8,.2);assert np.isfinite(eq).all() and (eq>0).all()
    changed=v8.copy();changed[-1]+=.5;eq2=separate_accounts(changed,v4,.8,.2)
    np.testing.assert_allclose(eq[:-1],eq2[:-1],rtol=0,atol=0);assert not np.isclose(eq[-1],eq2[-1])
    expected=.8*np.cumprod(1+v8)+.2*np.cumprod(1+v4)
    np.testing.assert_allclose(eq,expected,rtol=1e-13,atol=1e-13)
    print('Active V10 frozen-allocation integrity checks passed')
    return 0
if __name__=='__main__': raise SystemExit(main())
