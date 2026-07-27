# HF90 rebuilt official replay

```json
{
  "model_spec": {
    "training_start": "2024-02-12T00:00:00+00:00",
    "training_end_exclusive": "2024-04-30T22:55:00+00:00",
    "training_rows": 45478,
    "feature_count": 77,
    "params": {
      "boosting_type": "gbdt",
      "class_weight": null,
      "colsample_bytree": 1.0,
      "importance_type": "split",
      "learning_rate": 0.035,
      "max_depth": 4,
      "min_child_samples": 100,
      "min_child_weight": 0.001,
      "min_split_gain": 0.0,
      "n_estimators": 120,
      "n_jobs": 8,
      "num_leaves": 15,
      "objective": "regression_l1",
      "random_state": 37,
      "reg_alpha": 0.0,
      "reg_lambda": 10,
      "subsample": 1.0,
      "subsample_for_bin": 200000,
      "subsample_freq": 0,
      "verbosity": -1
    }
  },
  "base": {
    "trades": 2739,
    "mean_bps": -13.865869927958537,
    "pf": 0.6922127604874414,
    "win_rate": 0.47681635633442865
  },
  "stress": {
    "trades": 2613,
    "mean_bps": -19.941812183299184,
    "pf": 0.594459124501562,
    "win_rate": 0.44814389590508996
  },
  "periods": [
    {
      "period": "2024Q4",
      "base_trades": 506,
      "base_mean_bps": -9.877129352145701,
      "base_pf": 0.7524592091274093,
      "base_win_rate": 0.4743083003952569,
      "stress_trades": 479,
      "stress_mean_bps": -17.516743276075047,
      "stress_pf": 0.6097621861200864,
      "stress_win_rate": 0.44676409185803756
    },
    {
      "period": "2025",
      "base_trades": 1560,
      "base_mean_bps": -16.04018734379477,
      "base_pf": 0.6604353886943556,
      "base_win_rate": 0.4717948717948718,
      "stress_trades": 1495,
      "stress_mean_bps": -22.313620618980316,
      "stress_pf": 0.5650920030044072,
      "stress_win_rate": 0.44481605351170567
    },
    {
      "period": "2026H1",
      "base_trades": 673,
      "base_mean_bps": -11.824811328637244,
      "base_pf": 0.7303436962335471,
      "base_win_rate": 0.4903417533432392,
      "stress_trades": 639,
      "stress_mean_bps": -16.21059840429615,
      "stress_pf": 0.6579716548480937,
      "stress_win_rate": 0.4569640062597809
    },
    {
      "period": "full",
      "base_trades": 2739,
      "base_mean_bps": -13.865869927958537,
      "base_pf": 0.6922127604874414,
      "base_win_rate": 0.47681635633442865,
      "stress_trades": 2613,
      "stress_mean_bps": -19.941812183299184,
      "stress_pf": 0.594459124501562,
      "stress_win_rate": 0.44814389590508996
    }
  ],
  "by_symbol": {
    "BTCUSDT": {
      "trades": 914,
      "mean_bps": -13.208134936235444,
      "pf": 0.6712923558299005,
      "win_rate": 0.449671772428884
    },
    "ETHUSDT": {
      "trades": 1825,
      "mean_bps": -14.19527802792287,
      "pf": 0.701078170572097,
      "win_rate": 0.4904109589041096
    }
  },
  "by_side": {
    "LONG": {
      "trades": 1759,
      "mean_bps": -14.386624263187985,
      "pf": 0.6961446779358228,
      "win_rate": 0.4826606026151222
    },
    "SHORT": {
      "trades": 980,
      "mean_bps": -12.931169034419149,
      "pf": 0.6840484616239447,
      "win_rate": 0.4663265306122449
    }
  },
  "bootstrap": {
    "lo": -18.39211509337987,
    "hi": -9.386869760667455,
    "p_positive": 0.0
  },
  "without_top20": {
    "trades": 2719,
    "mean_bps": -16.495809970943327,
    "pf": 0.6365084587137609,
    "win_rate": 0.47296800294225816
  },
  "accounts": [
    {
      "fraction_per_symbol": 0.1,
      "max_gross_pct": 20.0,
      "end_usd": 6824.508097759927,
      "pnl_usd": -3175.4919022400727,
      "return_pct": -31.754919022400728,
      "annualized_pct": -18.84124144828888,
      "closed_dd_pct": 32.59042509159258,
      "trades": 2739
    },
    {
      "fraction_per_symbol": 0.25,
      "max_gross_pct": 50.0,
      "end_usd": 3814.625393966112,
      "pnl_usd": -6185.374606033888,
      "return_pct": -61.853746060338885,
      "annualized_pct": -40.93879435318393,
      "closed_dd_pct": 62.995023841951195,
      "trades": 2739
    },
    {
      "fraction_per_symbol": 0.5,
      "max_gross_pct": 100.0,
      "end_usd": 1413.8273611979089,
      "pnl_usd": -8586.17263880209,
      "return_pct": -85.86172638802091,
      "annualized_pct": -65.66235722196863,
      "closed_dd_pct": 86.67639438517647,
      "trades": 2739
    },
    {
      "fraction_per_symbol": 1.0,
      "max_gross_pct": 200.0,
      "end_usd": 177.85801940600365,
      "pnl_usd": -9822.141980593997,
      "return_pct": -98.22141980593997,
      "annualized_pct": -88.93815523059764,
      "closed_dd_pct": 98.4115950523608,
      "trades": 2739
    },
    {
      "fraction_per_symbol": 1.5,
      "max_gross_pct": 300.0,
      "end_usd": 19.838766268640533,
      "pnl_usd": -9980.16123373136,
      "return_pct": -99.8016123373136,
      "annualized_pct": -96.66310461270996,
      "closed_dd_pct": 99.83153205999966,
      "trades": 2739
    },
    {
      "fraction_per_symbol": 2.0,
      "max_gross_pct": 400.0,
      "end_usd": 1.9541756517295024,
      "pnl_usd": -9998.04582434827,
      "return_pct": -99.9804582434827,
      "annualized_pct": -99.05950637065165,
      "closed_dd_pct": 99.98419165394151,
      "trades": 2739
    }
  ],
  "funding_total_bps": 6.596100000000002
}
```
