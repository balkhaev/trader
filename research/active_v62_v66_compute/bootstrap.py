#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,hashlib,io,json,py_compile,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
M=json.loads((ROOT/'manifest.json').read_text())
def sha(b:bytes)->str:return hashlib.sha256(b).hexdigest()
def reconstruct()->Path:
    parts=[]
    for meta in M['parts']:
        p=ROOT/'payload'/meta['path'];b=p.read_bytes()
        if len(b)!=meta['bytes'] or sha(b)!=meta['sha256']:raise SystemExit(f'part integrity failure {p}')
        parts.append(b)
    enc=b''.join(parts)
    if len(enc)!=M['encoded_bytes'] or sha(enc)!=M['encoded_sha256']:raise SystemExit('encoded integrity failure')
    raw=base64.b64decode(enc,validate=True)
    if len(raw)!=M['archive_bytes'] or sha(raw)!=M['archive_sha256']:raise SystemExit('archive integrity failure')
    out=ROOT/'generated';out.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:bz2') as tf:
        members=tf.getmembers()
        if any(Path(x.name).is_absolute() or '..' in Path(x.name).parts for x in members):raise SystemExit('unsafe archive member')
        tf.extractall(out,filter='data')
    for name,meta in M['source_files'].items():
        p=out/name
        if not p.exists() or p.stat().st_size!=meta['bytes'] or sha(p.read_bytes())!=meta['sha256']:raise SystemExit(f'source integrity failure {name}')
        if p.suffix=='.py':py_compile.compile(str(p),doraise=True)
    return out
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--extract-only',action='store_true');a=ap.parse_args();out=reconstruct();print(out)
if __name__=='__main__':main()
