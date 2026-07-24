#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,hashlib,io,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
M=json.loads((ROOT/'manifest.json').read_text())
def sha(x:bytes)->str:return hashlib.sha256(x).hexdigest()
def reconstruct()->Path:
    parts=sorted((ROOT/'payload').glob('part_*.b64'))
    if len(parts)!=M['parts']:raise SystemExit('payload part count mismatch')
    for p,meta in zip(parts,M['part_files']):
        data=p.read_bytes().strip()
        if p.name!=meta['path'] or len(data)!=meta['bytes'] or sha(data)!=meta['sha256']:raise SystemExit(f'part integrity failure: {p.name}')
    enc=b''.join(p.read_bytes().strip() for p in parts)
    if len(enc)!=M['encoded_bytes'] or sha(enc)!=M['encoded_sha256']:raise SystemExit('encoded integrity failure')
    arc=base64.b64decode(enc,validate=True)
    if len(arc)!=M['archive_bytes'] or sha(arc)!=M['archive_sha256']:raise SystemExit('archive integrity failure')
    gen=ROOT/'generated';gen.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(arc),mode='r:bz2') as tf:
        names=[m.name for m in tf.getmembers()]
        if any(Path(n).is_absolute() or '..' in Path(n).parts for n in names):raise SystemExit('unsafe archive')
        tf.extractall(gen,filter='data')
    for n,h in M['source_files'].items():
        if sha((gen/n).read_bytes())!=h:raise SystemExit(f'source mismatch: {n}')
    return gen
def main()->int:
    ap=argparse.ArgumentParser(add_help=False);ap.add_argument('--extract-only',action='store_true');a,rest=ap.parse_known_args();g=reconstruct()
    if a.extract_only:print(g);return 0
    return subprocess.call([sys.executable,str(g/'run.py'),*rest])
if __name__=='__main__':raise SystemExit(main())
