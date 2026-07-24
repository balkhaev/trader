from __future__ import annotations
import argparse,hashlib,itertools,json,sys
from dataclasses import asdict,dataclass
from pathlib import Path
import numpy as np
import pandas as pd

HERE=Path(__file__).resolve().parent

@dataclass(frozen=True)
class ExecPolicy:
    name:str
    kind:str
    a:float
    b:float=0.0
    c:int=0

SCHEDULE_DAYS=(7,14,28)
HYSTERESIS=((.50,0.),(.50,1/6),(.667,0.),(.667,1/6),(.833,0.),(.833,1/6))
BANDS=((.25,14),(.25,28),(.25,56),(.50,14),(.50,28),(.50,56))
CONFIRM=((.50,3),(.50,7),(.667,3),(.667,7),(.833,3),(.833,7))

GATES={
 'prefinal_cagr_min':.10,'prefinal_sharpe_min':.75,'prefinal_max_drawdown_min':-.35,
 'prefinal_turnover_max':10.,'worst_severe_segment_min':-.12,'worst_extreme_segment_min':-.20,
}

def schedule_one(raw:pd.Series,every:int,offset:int)->pd.Series:
    x=raw.fillna(0.).clip(0,1).to_numpy(float);out=np.zeros(len(x));state=0.
    for i,v in enumerate(x):
        if v<=0:state=0.
        elif i%every==offset:state=v
        out[i]=state
    return pd.Series(out,index=raw.index)

def schedule_family(raw:pd.Series)->pd.Series:
    variants=[]
    for n in SCHEDULE_DAYS:
        variants.extend(schedule_one(raw,n,o) for o in range(n))
    return pd.concat(variants,axis=1).mean(axis=1)

def hysteresis_one(raw:pd.Series,enter:float,exit_:float)->pd.Series:
    x=raw.fillna(0.).clip(0,1).to_numpy(float);out=np.zeros(len(x));state=0.
    for i,v in enumerate(x):
        if state<=0 and v>=enter:state=1.
        elif state>0 and v<=exit_:state=0.
        out[i]=state
    return pd.Series(out,index=raw.index)

def hysteresis_family(raw:pd.Series)->pd.Series:
    return pd.concat([hysteresis_one(raw,e,x) for e,x in HYSTERESIS],axis=1).mean(axis=1)

def band_one(raw:pd.Series,band:float,max_age:int)->pd.Series:
    x=raw.fillna(0.).clip(0,1).to_numpy(float);out=np.zeros(len(x));state=0.;age=0
    for i,v in enumerate(x):
        if v<=0:state=0.;age=0
        elif abs(v-state)>=band or age>=max_age:state=v;age=0
        else:age+=1
        out[i]=state
    return pd.Series(out,index=raw.index)

def band_family(raw:pd.Series)->pd.Series:
    return pd.concat([band_one(raw,b,a) for b,a in BANDS],axis=1).mean(axis=1)

def confirm_one(raw:pd.Series,threshold:float,days:int)->pd.Series:
    x=raw.fillna(0.).clip(0,1);qual=(x>=threshold).rolling(days,min_periods=days).sum()>=days
    out=np.zeros(len(x));state=0.
    for i,(v,q) in enumerate(zip(x.to_numpy(float),qual.to_numpy(bool))):
        if v<=0:state=0.
        elif q:state=1.
        out[i]=state
    return pd.Series(out,index=raw.index)

def confirm_family(raw:pd.Series)->pd.Series:
    return pd.concat([confirm_one(raw,t,d) for t,d in CONFIRM],axis=1).mean(axis=1)

def build_books(raw:pd.Series)->dict[str,pd.Series]:
    fam={'schedule':schedule_family(raw),'hysteresis':hysteresis_family(raw),'band':band_family(raw),'confirmation':confirm_family(raw)}
    out={}
    names=tuple(fam)
    for n in range(1,len(names)+1):
        for combo in itertools.combinations(names,n):out['+'.join(combo)]=pd.concat([fam[x] for x in combo],axis=1).mean(axis=1)
    return out

def eligible(rows,pre):
    return bool(pre['annualized_return']>=GATES['prefinal_cagr_min'] and pre['sharpe']>=GATES['prefinal_sharpe_min'] and pre['max_drawdown']>=GATES['prefinal_max_drawdown_min'] and pre['annual_turnover']<=GATES['prefinal_turnover_max'] and min(rows['stress'][p]['total_return'] for p in SEGMENTS)>0 and min(rows['severe'][p]['total_return'] for p in SEGMENTS)>GATES['worst_severe_segment_min'] and min(rows['extreme'][p]['total_return'] for p in SEGMENTS)>GATES['worst_extreme_segment_min'])

def score(rows,pre):
    return float(pre['annualized_return']+0.08*pre['sharpe']+0.12*min(rows['stress'][p]['total_return'] for p in SEGMENTS)-0.08*abs(pre['max_drawdown'])-0.002*pre['annual_turnover'])

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--cache',type=Path,required=True);p.add_argument('--output',type=Path,required=True);q=p.parse_args();q.output.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,str(q.source.resolve()))
    from config import Config,PERIODS,SEGMENTS,SCENARIOS
    globals()['SEGMENTS']=SEGMENTS
    from data import load
    from strategy import build_families,simulate
    from metrics import metrics,yearly,block_bootstrap
    cfg=Config();d,quality,manifest=load(cfg,q.cache);spot,_=build_families(d);raw=spot['exchange_pressure'];books=build_books(raw)
    table=[];evidence={}
    for name,sig in books.items():
        rows={sc:{} for sc in ('stress','severe','extreme')}
        for sc in rows:
            for per in (*SEGMENTS,'prefinal'):
                rows[sc][per]=metrics(simulate(d,sig,*PERIODS[per],SCENARIOS[sc],'spot',1.,cfg.forced_exit_bps))
        pre=rows['stress']['prefinal'];ok=eligible(rows,pre);sc=score(rows,pre)
        table.append({'candidate':name,'eligible_before_final':ok,'score':sc,**{f'prefinal_{k}':v for k,v in pre.items()},'worst_stress_segment':min(rows['stress'][p]['total_return'] for p in SEGMENTS),'worst_severe_segment':min(rows['severe'][p]['total_return'] for p in SEGMENTS),'worst_extreme_segment':min(rows['extreme'][p]['total_return'] for p in SEGMENTS)})
        evidence[name]=rows
    lib=pd.DataFrame(table).sort_values(['eligible_before_final','score'],ascending=[False,False]);lib.to_csv(q.output/'selection_library.csv',index=False)
    leader=str(lib.iloc[0].candidate);pre=evidence[leader]['stress']['prefinal'];proof={'candidate':'ACTIVE_V46_EXECUTION_AWARE_ONCHAIN','selection_excludes_final':True,'program_level_final_is_pristine':False,'raw_source':'V44 exchange_pressure fixed before V46','policy_families':{'schedule_days':SCHEDULE_DAYS,'hysteresis':HYSTERESIS,'bands':BANDS,'confirmation':CONFIRM},'process_count':len(books),'leader':leader,'eligible_before_final':bool(lib.iloc[0].eligible_before_final),'score':float(lib.iloc[0].score),'prefinal':pre,'all_stress_segments_positive':min(evidence[leader]['stress'][p]['total_return'] for p in SEGMENTS)>0,'worst_severe_segment':min(evidence[leader]['severe'][p]['total_return'] for p in SEGMENTS),'worst_extreme_segment':min(evidence[leader]['extreme'][p]['total_return'] for p in SEGMENTS),'gates':GATES,'data_quality':quality}
    proof['selection_proof_sha256']=hashlib.sha256(json.dumps(proof,sort_keys=True,default=list).encode()).hexdigest();(q.output/'selection_proof_before_final.json').write_text(json.dumps(proof,indent=2,default=list))
    sig=books[leader];rows=[];accounts={}
    for sc,bps in SCENARIOS.items():
        for per in (*SEGMENTS,'prefinal','final_2026_ytd','full'):
            a=simulate(d,sig,*PERIODS[per],bps,'spot',1.,cfg.forced_exit_bps);rows.append({'scenario':sc,'period':per,**metrics(a)});accounts[(sc,per)]=a
    pd.DataFrame(rows).to_csv(q.output/'metrics.csv',index=False)
    stress=accounts[('stress','full')];stress.to_csv(q.output/'stress_full_equity.csv');yearly(stress).to_csv(q.output/'yearly_stress.csv',index=False)
    preacc=accounts[('stress','prefinal')];boot=[]
    for block,horizon in itertools.product((30,60,120),(1095,2190)):boot.append(block_bootstrap(preacc.equity.pct_change(),block=block,horizon=horizon,seed=46000+block+horizon))
    pd.DataFrame(boot).to_csv(q.output/'block_bootstrap.csv',index=False)
    get=lambda sc,per:next(x for x in rows if x['scenario']==sc and x['period']==per)
    finalstress=get('stress','final_2026_ytd');finalsevere=get('severe','final_2026_ytd');status='frozen_paper_forward_candidate' if bool(lib.iloc[0].eligible_before_final) and finalstress['total_return']>0 and finalsevere['total_return']>0 else 'rejected_or_needs_iteration'
    summary={'candidate':'ACTIVE_V46_EXECUTION_AWARE_ONCHAIN','status':status,'leader':leader,'selection_proof_sha256':proof['selection_proof_sha256'],'selection_excludes_final':True,'program_level_final_is_pristine':False,'eligible_before_final':bool(lib.iloc[0].eligible_before_final),'prefinal':pre,'stress_full':get('stress','full'),'stress_final':finalstress,'severe_final':finalsevere,'strict_costs':{sc:{'full':get(sc,'full'),'final':get(sc,'final_2026_ytd')} for sc in SCENARIOS},'data_quality':quality,'decision':'V46 must pass independently before any V28 integration'}
    (q.output/'summary.json').write_text(json.dumps(summary,indent=2));pd.DataFrame(manifest).to_csv(q.output/'data_manifest.csv',index=False);(q.output/'provenance.json').write_text(json.dumps({'source':'V44/V45 pinned inputs','v44_compute_artifact':8604664000,'v44_selection_proof':'527c908e30e48497d3f27bc6846233daa9b2f0c4239b74f6a8431557628a00dd'},indent=2));print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
