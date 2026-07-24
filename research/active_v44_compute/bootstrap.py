#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,hashlib,io,json,py_compile,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def reconstruct():
    m=json.loads((ROOT/'manifest.json').read_text());parts=[]
    for x in m['parts']:
        p=ROOT/'payload'/x['path'];b=p.read_bytes();assert len(b)==x['bytes'],(p,len(b),x['bytes']);assert hashlib.sha256(b).hexdigest()==x['sha256'];parts.append(b)
    enc=b''.join(parts);assert len(enc)==m['encoded_bytes'];assert hashlib.sha256(enc).hexdigest()==m['encoded_sha256']
    raw=base64.b64decode(enc,validate=True);assert len(raw)==m['archive_bytes'];assert hashlib.sha256(raw).hexdigest()==m['archive_sha256']
    out=ROOT/'generated';out.mkdir(parents=True,exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:bz2') as tf:
        members=tf.getmembers();assert members;assert all(not Path(x.name).is_absolute() and '..' not in Path(x.name).parts for x in members);tf.extractall(out,filter='data')
    for name,meta in m['source_files'].items():
        p=out/name;assert p.exists() and p.stat().st_size==meta['bytes'];assert hashlib.sha256(p.read_bytes()).hexdigest()==meta['sha256']
    for p in out.glob('*.py'):py_compile.compile(str(p),doraise=True)
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument('--extract-only',action='store_true');p.add_argument('--self-test',action='store_true');p.add_argument('--cache',type=Path);p.add_argument('--output',type=Path);q=p.parse_args();out=reconstruct()
    if q.extract_only:return 0
    if q.self_test:return subprocess.call([sys.executable,str(out/'run.py'),'--self-test'],cwd=out)
    if q.cache is None or q.output is None:raise SystemExit('--cache and --output required')
    return subprocess.call([sys.executable,str(out/'run.py'),'--cache',str(q.cache.resolve()),'--output',str(q.output.resolve())],cwd=out)
if __name__=='__main__':raise SystemExit(main())
