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
ENCODED_SHA256 = "65094ab5473d47f29d0b2d5c81f537cc36d3d9bc62404f9308e4a5fe4d2c1e6f"
ARCHIVE_SHA256 = "486af01d727f8bce574268b5a82e61cf7445661fe29b0a907f6f19c1fdd9164e"
SOURCE_HASHES = {
    "export.py": "614efab4934c86c77081996f49d8b43aafce5f731d2ec2c11aa5fc753278fb8a",
    "requirements.txt": "6979eeaed30ec7f45ff725f33240136e49c396fdf8a5ef12964fb2960c8a5d1e",
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
    return subprocess.call([sys.executable, str(generated / "export.py"), *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
