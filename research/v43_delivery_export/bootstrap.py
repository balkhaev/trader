#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import io
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENCODED_SHA256 = "8e4f0f3dba9ba63f29951c32c622d5d47c69834604526f3e0d309374e42a87d7"
ARCHIVE_SHA256 = "35e6226ebe56741d96a3f91baf0e2109967775c7de636faa17c881f39b9e07d7"
SOURCE_HASHES = {
    "export_delivery.py": "d85ef9c961c19bc35b0ebe12d0e9f8195d2679eaaf0eff8dc5389ed2c7f96419",
    "requirements.txt": "e20405ec52e771e3001a1c20aa968f707dc300e5837e0941ba03cd51aaf738ec",
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def reconstruct() -> Path:
    encoded = (ROOT / "source.b64").read_bytes().strip()
    if sha(encoded) != ENCODED_SHA256:
        raise SystemExit("encoded payload integrity failure")
    archive = base64.b64decode(encoded, validate=True)
    if sha(archive) != ARCHIVE_SHA256:
        raise SystemExit("archive integrity failure")
    generated = ROOT / "generated"
    generated.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:bz2") as tar:
        members = tar.getmembers()
        if any(Path(member.name).is_absolute() or ".." in Path(member.name).parts for member in members):
            raise SystemExit("unsafe archive member")
        tar.extractall(generated, filter="data")
    for name, expected in SOURCE_HASHES.items():
        path = generated / name
        if not path.exists() or sha(path.read_bytes()) != expected:
            raise SystemExit(f"source hash mismatch: {name}")
    return generated


def main() -> int:
    generated = reconstruct()
    if "--extract-only" in sys.argv[1:]:
        print(generated)
        return 0
    return subprocess.call([sys.executable, str(generated / "export_delivery.py"), *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
