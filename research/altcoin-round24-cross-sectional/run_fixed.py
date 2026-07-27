from __future__ import annotations

import run_fast as fast

fast.base.CONFIGS = [
    fast.base.Config(
        "REV_Z15_K3_H60_FIXED",
        "reversal",
        1.5,
        3,
        4,
        False,
        False,
    )
]

if __name__ == "__main__":
    fast.base.main()
