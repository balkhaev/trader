#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,hashlib,io,json,py_compile,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
PATCHED_DATA_SHA256='c85adf9ca57f052eedb8ee06fa627db00b6d9b5ac673d83f9decaff21fe6fcbe'

def apply_data_quality_patch(out:Path):
    p=out/'data.py';s=p.read_text()
    old1="    if (met[['sum_open_interest','sum_open_interest_value','count_toptrader_long_short_ratio','sum_toptrader_long_short_ratio','count_long_short_ratio']]<=0).any().any():raise ValueError('non-positive metrics rows')\n    index=pd.date_range(cfg.start,cfg.end_exclusive,freq='8h',inclusive='left',tz='UTC');k=k.reindex(index);fund=fr.reindex(index).fillna(0.)\n"
    new1="    positive_metric_cols=['sum_open_interest','sum_open_interest_value','count_toptrader_long_short_ratio','sum_toptrader_long_short_ratio','count_long_short_ratio']\n    nonpositive=met[positive_metric_cols]<=0\n    nonpositive_rows=int(nonpositive.any(axis=1).sum());nonpositive_cells=int(nonpositive.sum().sum())\n    # Official archives occasionally contain zero-valued metric snapshots. Preserve\n    # the raw observations and never forward-fill them. The completed 8h snapshot\n    # is marked unavailable below whenever its final required metric is non-positive.\n    index=pd.date_range(cfg.start,cfg.end_exclusive,freq='8h',inclusive='left',tz='UTC');k=k.reindex(index);fund=fr.reindex(index).fillna(0.)\n"
    old2="        'metric_missing_8h':int((~metrics_available).sum()),'metric_duplicate_rows_removed':int(sum(len(x) for x in metric_parts)-len(met)),\n        'checksum_available':int(sum(bool(r['checksum_available']) for r in records)),'checksum_failed':int(sum(r['checksum_passed'] is False for r in records)),\n"
    new2="        'metric_missing_8h':int((~metrics_available).sum()),'metric_duplicate_rows_removed':int(sum(len(x) for x in metric_parts)-len(met)),\n        'metric_nonpositive_5m_rows':nonpositive_rows,'metric_nonpositive_5m_cells':nonpositive_cells,\n        'metric_nonpositive_5m_by_column':{c:int(nonpositive[c].sum()) for c in positive_metric_cols},\n        'checksum_available':int(sum(bool(r['checksum_available']) for r in records)),'checksum_failed':int(sum(r['checksum_passed'] is False for r in records)),\n"
    old_checksum="        if cp is False:raise ValueError('checksum mismatch '+url)"
    retry_month="""        if cp is False:
            print('checksum retry',url,flush=True);path.unlink(missing_ok=True);payload=request(url)
            if payload is None:raise ValueError('checksum source disappeared '+url)
            path.write_bytes(payload);digest=hashlib.sha256(payload).hexdigest();cp=value==digest
            if cp is False:raise ValueError('checksum mismatch after retry '+url)"""
    retry_metric="""        if cp is False:
            print('checksum retry',url,flush=True);path.unlink(missing_ok=True);payload=request(url,retries=6,timeout=90)
            if payload is None:raise ValueError('checksum source disappeared '+url)
            path.write_bytes(payload);digest=hashlib.sha256(payload).hexdigest();cp=value==digest
            if cp is False:raise ValueError('checksum mismatch after retry '+url)"""
    assert old1 in s and old2 in s and s.count(old_checksum)==2,'unexpected sealed data.py; refusing unverified patch'
    s=s.replace(old1,new1).replace(old2,new2).replace(old_checksum,retry_month,1).replace(old_checksum,retry_metric,1)
    p.write_text(s)
    assert hashlib.sha256(p.read_bytes()).hexdigest()==PATCHED_DATA_SHA256

def reconstruct():
    m=json.loads((ROOT/'manifest.json').read_text());parts=[]
    for x in m['parts']:
        p=ROOT/'payload'/x['path'];b=p.read_bytes();assert len(b)==x['bytes'],(p,len(b),x['bytes']);assert hashlib.sha256(b).hexdigest()==x['sha256'];parts.append(b)
    enc=b''.join(parts);assert len(enc)==m['encoded_bytes'];assert hashlib.sha256(enc).hexdigest()==m['encoded_sha256'];raw=base64.b64decode(enc,validate=True);assert len(raw)==m['archive_bytes'];assert hashlib.sha256(raw).hexdigest()==m['archive_sha256']
    out=ROOT/'generated';out.mkdir(parents=True,exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:bz2') as tf:
        members=tf.getmembers();assert all(not Path(x.name).is_absolute() and '..' not in Path(x.name).parts for x in members);tf.extractall(out,filter='data')
    for name,meta in m['source_files'].items():
        p=out/name;assert p.exists() and p.stat().st_size==meta['bytes'];assert hashlib.sha256(p.read_bytes()).hexdigest()==meta['sha256']
    apply_data_quality_patch(out)
    for p in out.glob('*.py'):py_compile.compile(str(p),doraise=True)
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument('--extract-only',action='store_true');p.add_argument('--self-test',action='store_true');p.add_argument('--cache',type=Path);p.add_argument('--output',type=Path);q=p.parse_args();out=reconstruct()
    if q.extract_only:return 0
    if q.self_test:return subprocess.call([sys.executable,str(out/'run.py'),'--self-test'],cwd=out)
    if q.cache is None or q.output is None:raise SystemExit('--cache and --output required')
    return subprocess.call([sys.executable,str(out/'run.py'),'--cache',str(q.cache.resolve()),'--output',str(q.output.resolve())],cwd=out)
if __name__=='__main__':raise SystemExit(main())
