#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,hashlib,io,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent;MANIFEST=json.loads((ROOT/'manifest.json').read_text())
def sha(x):return hashlib.sha256(x).hexdigest()
def reconstruct():
    parts=sorted((ROOT/'payload').glob('part_*'))
    if len(parts)!=MANIFEST['parts']:raise SystemExit(f'part count {len(parts)} != {MANIFEST["parts"]}')
    enc=b''.join(p.read_bytes().strip() for p in parts)
    if len(enc)!=MANIFEST['encoded_bytes'] or sha(enc)!=MANIFEST['encoded_sha256']:raise SystemExit('encoded payload integrity failure')
    raw=base64.b64decode(enc,validate=True)
    if len(raw)!=MANIFEST['archive_bytes'] or sha(raw)!=MANIFEST['archive_sha256']:raise SystemExit('archive payload integrity failure')
    out=ROOT/'generated';out.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:bz2') as tf:
        if any(Path(x.name).is_absolute() or '..' in Path(x.name).parts for x in tf.getmembers()):raise SystemExit('unsafe archive')
        tf.extractall(out,filter='data')
    for name,meta in MANIFEST['source_files'].items():
        p=out/name
        if not p.exists() or p.stat().st_size!=meta['bytes'] or sha(p.read_bytes())!=meta['sha256']:raise SystemExit('source mismatch '+name)
    return out
def main():
    p=argparse.ArgumentParser(add_help=False);p.add_argument('--extract-only',action='store_true');a,rest=p.parse_known_args();out=reconstruct()
    if a.extract_only:print(out);return 0
    return subprocess.call([sys.executable,str(out/'run.py'),*rest])
if __name__=='__main__':raise SystemExit(main())
