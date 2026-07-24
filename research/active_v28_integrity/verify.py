#!/usr/bin/env python3
from __future__ import annotations
import base64,hashlib,io,json,py_compile,tarfile,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
m=json.loads((ROOT/'manifest.json').read_text())
enc=(ROOT/'bundle.b64').read_bytes()
assert len(enc)==m['encoded_bytes'],(len(enc),m['encoded_bytes'])
assert hashlib.sha256(enc).hexdigest()==m['encoded_sha256']
raw=base64.b64decode(enc,validate=True)
assert len(raw)==m['archive_bytes']
assert hashlib.sha256(raw).hexdigest()==m['archive_sha256']
with tempfile.TemporaryDirectory() as td:
    td=Path(td)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:bz2') as tf:
        members=tf.getmembers()
        assert members
        assert all(not Path(x.name).is_absolute() and '..' not in Path(x.name).parts for x in members)
        tf.extractall(td,filter='data')
    sources=list(td.rglob('*.py'))
    assert len(sources)>=8,len(sources)
    for p in sources:py_compile.compile(str(p),doraise=True)
    summaries=list(td.rglob('summary.json'))
    frozen=list(td.rglob('frozen_candidate.json'))
    assert summaries and frozen
    s=json.loads(summaries[0].read_text());f=json.loads(frozen[0].read_text())
    assert s['status']=='frozen_paper_forward_candidate'
    assert all(s['acceptance_checks'].values())
    assert s['stress_full']['annualized_return']>.30
    assert s['stress_full']['max_drawdown']>-.30
    assert s['funding_audits']['fund60']['full_cagr']>.29
    assert s['funding_audits']['fund80_margin125']['final_return']>0
    assert f['candidate']=='ACTIVE_V28_EXACT8H_BREAKOUT_CARRY_CASH'
    assert f['target_gross_cap']==.85
    assert f['selection_excludes_2026h1'] is True
print('Active V28 public integrity passed')
