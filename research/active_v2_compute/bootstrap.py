#!/usr/bin/env python3
from __future__ import annotations
import base64, hashlib, json, subprocess, sys, tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
MANIFEST=json.loads((ROOT/'manifest.json').read_text())
def sha(data: bytes)->str: return hashlib.sha256(data).hexdigest()
def reconstruct()->Path:
    parts=sorted((ROOT/'payload').glob('part_*.b64'))
    if len(parts)!=MANIFEST['parts']: raise SystemExit(f"payload part count mismatch: {len(parts)}")
    encoded=b''.join(p.read_bytes().strip() for p in parts)
    if len(encoded)!=MANIFEST['encoded_bytes'] or sha(encoded)!=MANIFEST['encoded_sha256']:
        raise SystemExit('encoded payload integrity failure')
    archive=base64.b64decode(encoded, validate=True)
    if len(archive)!=MANIFEST['archive_bytes'] or sha(archive)!=MANIFEST['archive_sha256']:
        raise SystemExit('archive payload integrity failure')
    generated=ROOT/'generated'
    generated.mkdir(exist_ok=True)
    with tarfile.open(fileobj=__import__('io').BytesIO(archive), mode='r:bz2') as tf:
        names={m.name for m in tf.getmembers()}
        if any(Path(n).is_absolute() or '..' in Path(n).parts for n in names):
            raise SystemExit('unsafe archive member')
        tf.extractall(generated, filter='data')
    for name, expected in MANIFEST['source_files'].items():
        if sha((generated/name).read_bytes())!=expected: raise SystemExit(f'source hash mismatch: {name}')
    return generated

def main()->int:
    generated=reconstruct()
    command=[sys.executable, str(generated/'run_research.py'), *sys.argv[1:]]
    return subprocess.call(command)
if __name__=='__main__': raise SystemExit(main())
