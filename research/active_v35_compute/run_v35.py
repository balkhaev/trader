#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json,sys
from itertools import combinations
from pathlib import Path
import numpy as np
import pandas as pd
from numba import njit

ROOT=Path(__file__).resolve().parent
GEN=ROOT.parent/'active_v33_compute'/'generated';sys.path.insert(0,str(GEN))
from config import Config,PERIODS,PREFINAL_PERIODS,COSTS_BPS
from data import load
from metrics import metrics,process_score

FAMILIES=('fast_dispersion','slow_dispersion','crowding_reversal','momentum_conditioned')
GATES={'all_stress_segments_positive':True,'worst_severe_segment_min':-.08,'worst_extreme_segment_min':-.15,'prefinal_cagr_min':.05,'prefinal_max_drawdown_min':-.20,'prefinal_turnover_max':20.}

@njit(cache=True)
def rollmean(x,look):
 n,m=x.shape;out=np.empty((n,m));out[:]=np.nan;s=np.zeros(m);c=np.zeros(m,np.int64)
 for i in range(n):
  for j in range(m):
   v=x[i,j]
   if np.isfinite(v):s[j]+=v;c[j]+=1
   if i>=look:
    z=x[i-look,j]
    if np.isfinite(z):s[j]-=z;c[j]-=1
   if i+1>=look and c[j]>=max(2,look//2):out[i,j]=s[j]/c[j]
 return out

@njit(cache=True)
def variant(exp,retx,vol,avail,min_spread,k,gross,reb,wmode,filter_mode):
 n,m=exp.shape;out=np.zeros((n,m));cur=np.zeros(m);last=-10**9
 for i in range(n):
  for j in range(m):
   if not avail[i,j] or not np.isfinite(exp[i,j]):cur[j]=0.
  if i-last<reb:out[i]=cur;continue
  lo=np.empty(m,np.int64);hi=np.empty(m,np.int64);lv=np.empty(m);hv=np.empty(m);nl=0;nh=0
  for j in range(m):
   if not avail[i,j] or not np.isfinite(exp[i,j]):continue
   lf=True;sf=True
   if filter_mode==1:
    lf=np.isfinite(retx[i,j]) and retx[i,j]<0;sf=np.isfinite(retx[i,j]) and retx[i,j]>0
   elif filter_mode==2:
    lf=np.isfinite(retx[i,j]) and retx[i,j]>0;sf=np.isfinite(retx[i,j]) and retx[i,j]<0
   if lf:lo[nl]=j;lv[nl]=-exp[i,j];nl+=1
   if sf:hi[nh]=j;hv[nh]=exp[i,j];nh+=1
  cur[:]=0.;use=min(k,nl,nh)
  if use>0:
   li=np.empty(use,np.int64);si=np.empty(use,np.int64);le=np.empty(use);se=np.empty(use)
   for z in range(use):
    bi=-1;bv=-1e99
    for q in range(nl):
     used=False
     for u in range(z):
      if lo[q]==li[u]:used=True;break
     if not used and lv[q]>bv:bi=q;bv=lv[q]
    li[z]=lo[bi];le[z]=-lv[bi]
    bi=-1;bv=-1e99
    for q in range(nh):
     used=False
     for u in range(z):
      if hi[q]==si[u]:used=True;break
     if not used and hv[q]>bv:bi=q;bv=hv[q]
    si[z]=hi[bi];se[z]=hv[bi]
   spread=0.
   for z in range(use):spread+=se[z]-le[z]
   spread/=use
   if spread>=min_spread:
    dl=0.;ds=0.
    for z in range(use):
     if wmode==0:wl=1.;ws=1.
     elif wmode==1:wl=max(1e-6,se[z]-le[z]);ws=wl
     else:wl=1./max(vol[i,li[z]],1e-4);ws=1./max(vol[i,si[z]],1e-4)
     dl+=wl;ds+=ws
    for z in range(use):
     if wmode==0:wl=1.;ws=1.
     elif wmode==1:wl=max(1e-6,se[z]-le[z]);ws=wl
     else:wl=1./max(vol[i,li[z]],1e-4);ws=1./max(vol[i,si[z]],1e-4)
     cur[li[z]]=gross*.5*wl/dl;cur[si[z]]=-gross*.5*ws/ds
  last=i;out[i]=cur
 return out

@njit(cache=True)
def sim(po,pc,fund,avail,sig,a,b,cost,forced,start_eq):
 m=po.shape[1];n=b-a;cash=start_eq;pos=np.zeros(m);pending=sig[a-1].copy() if a>0 else np.zeros(m);prev=-1
 eqs=np.empty(n);gross=np.empty(n);turn=np.empty(n);costs=np.empty(n);fpnl=np.empty(n)
 for row,i in enumerate(range(a,b)):
  fcost=0.;fnot=0.;fp=0.
  if prev>=0:
   for j in range(m):
    if abs(pos[j])>0:
     if avail[i,j] and np.isfinite(pc[prev,j]) and pc[prev,j]>0:
      r=po[i,j]/pc[prev,j];cash+=pos[j]*(r-1);pos[j]*=r
     else:fnot+=abs(pos[j]);fcost+=abs(pos[j])*forced;cash-=abs(pos[j])*forced;pos[j]=0.
   for j in range(m):
    if abs(pos[j])>0:v=-pos[j]*fund[i,j];cash+=v;fp+=v
  eqo=cash;actual=pos/eqo;target=pending.copy()
  for j in range(m):
   if not avail[i,j]:target[j]=0.
  g=np.sum(np.abs(target))
  if g>.5:target*=.5/g
  t=np.sum(np.abs(target-actual));tc=eqo*t*cost;after=max(0.,eqo-tc);pos=target*after;cash=after
  for j in range(m):
   if avail[i,j] and po[i,j]>0:
    r=pc[i,j]/po[i,j];cash+=pos[j]*(r-1);pos[j]*=r
  eq=cash;eqs[row]=eq;gross[row]=np.sum(np.abs(pos))/max(eq,1e-12);turn[row]=t+fnot/max(eqo,1e-12);costs[row]=tc+fcost;fpnl[row]=fp;pending=sig[i].copy();prev=i
 return eqs,gross,turn,costs,fpnl

def build_families(m):
 f=m.funding.to_numpy(float);close=m.perp_close;ret=close.pct_change(9,fill_method=None).to_numpy(float);vol=(close.pct_change(fill_method=None).rolling(90,min_periods=45).std()*np.sqrt(365*3)).to_numpy(float);av=m.available.to_numpy(bool);exp={x:rollmean(f,x)*365*3 for x in (3,9,21,42)};shape=av.shape
 specs={
  'fast_dispersion':[(l,s,k,g,r,w,q) for l in (3,9) for s in (.15,.30,.50) for k in (1,2) for g in (.20,.30) for r in (3,9) for w in (0,1) for q in (0,)],
  'slow_dispersion':[(l,s,k,g,r,w,q) for l in (21,42) for s in (.08,.15,.25) for k in (2,3) for g in (.20,.30,.40) for r in (9,21) for w in (0,2) for q in (0,)],
  'crowding_reversal':[(l,s,k,g,r,w,q) for l in (9,21) for s in (.15,.30) for k in (1,2) for g in (.20,.30) for r in (3,9) for w in (0,1) for q in (1,)],
  'momentum_conditioned':[(l,s,k,g,r,w,q) for l in (9,21) for s in (.15,.30) for k in (1,2) for g in (.20,.30) for r in (3,9) for w in (0,2) for q in (2,)],
 }
 out={};counts={}
 for name,sp in specs.items():
  acc=np.zeros(shape)
  for l,s,k,g,r,w,q in sp:acc+=variant(exp[l],ret,vol,av,s,k,g,r,w,q)
  out[name]=pd.DataFrame(acc/len(sp),index=m.index,columns=m.symbols);counts[name]=len(sp)
 return out,counts

def processes(fam):
 return {'+'.join(sub):sum(fam[x] for x in sub)/len(sub) for n in range(1,5) for sub in combinations(FAMILIES,n)}

def simulate(m,s,start,end,bps):
 a=int(m.index.searchsorted(pd.Timestamp(start,tz='UTC')));b=int(m.index.searchsorted(pd.Timestamp(end,tz='UTC')));z=sim(m.perp_open.to_numpy(float),m.perp_close.to_numpy(float),m.funding.to_numpy(float),m.available.to_numpy(bool),s.reindex(m.index).fillna(0).to_numpy(float),a,b,bps/10000.,.01,10000.)
 return pd.DataFrame({'equity':z[0],'gross':z[1],'turnover':z[2],'costs':z[3],'funding_pnl':z[4]},index=m.index[a:b])

def main():
 p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=Path('.cache/v33'));p.add_argument('--output',type=Path,default=Path('artifacts/v35'));a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);m,manifest,quality=load(Config(),a.cache);fam,counts=build_families(m);procs=processes(fam);rows=[]
 for name,sig in procs.items():
  for scen in ('stress','severe','extreme'):
   for per in ('prefinal',*PREFINAL_PERIODS):
    ac=simulate(m,sig,*PERIODS[per],COSTS_BPS[scen]);rows.append({'candidate':name,'scenario':scen,'period':per,**metrics(ac)})
 df=pd.DataFrame(rows);rank=[]
 for name in procs:
  z=df[df.candidate==name];pr=z[(z.scenario=='stress')&(z.period=='prefinal')].iloc[0];sg=z[(z.scenario=='stress')&z.period.isin(PREFINAL_PERIODS)];se=z[(z.scenario=='severe')&z.period.isin(PREFINAL_PERIODS)];ex=z[(z.scenario=='extreme')&z.period.isin(PREFINAL_PERIODS)]
  ok=bool((sg.total_return>0).all() and se.total_return.min()>GATES['worst_severe_segment_min'] and ex.total_return.min()>GATES['worst_extreme_segment_min'] and pr.annualized_return>=GATES['prefinal_cagr_min'] and pr.max_drawdown>=GATES['prefinal_max_drawdown_min'] and pr.annual_turnover<=GATES['prefinal_turnover_max'])
  rank.append({'candidate':name,'eligible_before_final':ok,'score':process_score(z),'prefinal_cagr':pr.annualized_return,'prefinal_dd':pr.max_drawdown,'turnover':pr.annual_turnover,'worst_stress':sg.total_return.min(),'worst_severe':se.total_return.min(),'worst_extreme':ex.total_return.min()})
 ranking=pd.DataFrame(rank).sort_values(['eligible_before_final','score'],ascending=False);ranking.to_csv(a.output/'selection_before_final.csv',index=False);sel=ranking[ranking.eligible_before_final].iloc[0] if ranking.eligible_before_final.any() else ranking.iloc[0];name=str(sel.candidate);proof={'candidate':'ACTIVE_V35_FUNDING_DISPERSION','selection_uses_2021_2025_only':True,'gates':GATES,'families':counts,'process_count':len(procs),'ranking':ranking.to_dict(orient='records'),'selected':name,'selected_eligible':bool(sel.eligible_before_final)};(a.output/'selection_proof_before_final.json').write_text(json.dumps(proof,indent=2));ph=hashlib.sha256((a.output/'selection_proof_before_final.json').read_bytes()).hexdigest()
 for scen,bps in COSTS_BPS.items():
  for per in ('full','final_2026h1'):
   ac=simulate(m,procs[name],*PERIODS[per],bps);rows.append({'candidate':name,'scenario':scen,'period':per,**metrics(ac)})
 df=pd.DataFrame(rows);df.to_csv(a.output/'metrics.csv',index=False);get=lambda s,p:df[(df.candidate==name)&(df.scenario==s)&(df.period==p)].iloc[-1];full=get('stress','full');fin=get('stress','final_2026h1');status='frozen_paper_forward_candidate' if bool(sel.eligible_before_final) and fin.total_return>0 and get('severe','final_2026h1').total_return>0 else 'rejected_or_needs_iteration';summary={'candidate':'ACTIVE_V35_FUNDING_DISPERSION','status':status,'selected_process':name,'selection_proof_sha256':ph,'selection_excludes_2026h1':True,'selected_eligible_before_final':bool(sel.eligible_before_final),'prefinal':{k:float(sel[k]) for k in ('prefinal_cagr','prefinal_dd','turnover','worst_stress','worst_severe','worst_extreme')},'stress_full':{k:float(full[k]) for k in ('annualized_return','total_return','max_drawdown','sharpe','annual_turnover','average_gross','max_gross','funding_pnl','costs')},'stress_final_2026h1':{k:float(fin[k]) for k in ('annualized_return','total_return','max_drawdown','sharpe','annual_turnover','average_gross','max_gross','funding_pnl','costs')},'strict_costs':{s:{'full_cagr':float(get(s,'full').annualized_return),'full_return':float(get(s,'full').total_return),'full_dd':float(get(s,'full').max_drawdown),'final_return':float(get(s,'final_2026h1').total_return)} for s in COSTS_BPS}};(a.output/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
