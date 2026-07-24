from __future__ import annotations
import argparse, base64, hashlib, io, json, subprocess, sys, tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
M=json.loads((ROOT/'manifest.json').read_text())
def sha(b:bytes)->str:return hashlib.sha256(b).hexdigest()
def reconstruct()->Path:
    parts=[]
    for x in M['parts']:
        b=(ROOT/'payload'/x['path']).read_bytes()
        assert len(b)==x['bytes'] and sha(b)==x['sha256'], x['path']
        parts.append(b)
    enc=b''.join(parts); assert len(enc)==M['encoded_bytes'] and sha(enc)==M['encoded_sha256']
    raw=base64.b64decode(enc,validate=True); assert len(raw)==M['archive_bytes'] and sha(raw)==M['archive_sha256']
    dest=ROOT/'generated'; dest.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:bz2') as tf:
        members=tf.getmembers(); assert all(not Path(m.name).is_absolute() and '..' not in Path(m.name).parts for m in members)
        tf.extractall(dest,filter='data')
    return dest
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--verify',action='store_true');a=p.parse_args();d=reconstruct()
    if a.verify:
        raise SystemExit(subprocess.call([sys.executable,str(d/'verify_checkpoint_v68.py')],cwd=d))
    print(d)
