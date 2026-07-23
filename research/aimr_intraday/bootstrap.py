#!/usr/bin/env python3
"""Reconstruct and execute the deterministic AIMR research runner.

The runner is stored as a compressed, integrity-checked payload because the
GitHub connector used to publish this isolated research branch has a small
per-write text budget. The generated readable Python source is copied into the
workflow artifact before execution. A separate driver performs independently
initialized validation and test runs.
"""
from __future__ import annotations

import base64
import bz2
import hashlib
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARTS = sorted((ROOT / "payload").glob("part_*.b64"))
EXPECTED_PARTS = 7
EXPECTED_ENCODED_BYTES = 15084
EXPECTED_ENCODED_SHA256 = "3acca7fc4d42243099373a41b0d4e42979160a97e4196b4d66fa4658eddf02b5"
EXPECTED_COMPRESSED_SHA256 = "7634ec3336b64f0a9311db0bc7bdecb8978f8f84fb07f976e3797743842c8a12"
EXPECTED_SOURCE_SHA256 = "31d5a328711ed143717173f2d936b67e7f36865dffb82d10e20dc94088eaef79"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def output_path_from_argv() -> Path | None:
    for index, value in enumerate(sys.argv):
        if value == "--output" and index + 1 < len(sys.argv):
            return Path(sys.argv[index + 1])
        if value.startswith("--output="):
            return Path(value.split("=", 1)[1])
    return None


if len(PARTS) != EXPECTED_PARTS:
    raise SystemExit(f"Expected {EXPECTED_PARTS} payload parts, found {len(PARTS)}")

encoded = b"".join(part.read_bytes().strip() for part in PARTS)
if len(encoded) != EXPECTED_ENCODED_BYTES or sha256(encoded) != EXPECTED_ENCODED_SHA256:
    raise SystemExit("AIMR encoded payload integrity check failed")

compressed = base64.b64decode(encoded, validate=True)
if sha256(compressed) != EXPECTED_COMPRESSED_SHA256:
    raise SystemExit("AIMR compressed payload integrity check failed")

source = bz2.decompress(compressed)
if sha256(source) != EXPECTED_SOURCE_SHA256:
    raise SystemExit("AIMR generated source integrity check failed")

generated = ROOT / "_generated_run_backtest.py"
generated.write_bytes(source)

output = output_path_from_argv()
if output is not None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "run_backtest.py").write_bytes(source)
    (output / "driver.py").write_bytes((ROOT / "driver.py").read_bytes())
    (output / "source_integrity.txt").write_text(
        f"sha256={EXPECTED_SOURCE_SHA256}\nbytes={len(source)}\n",
        encoding="utf-8",
    )

driver = ROOT / "driver.py"
sys.argv[0] = str(driver)
runpy.run_path(
    str(driver),
    run_name="__main__",
    init_globals={"GENERATED_RUNNER": generated},
)
