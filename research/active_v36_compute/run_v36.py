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
from strategy import simulate_numba
FAMILIES=('fast_dislocation','slow_convergence','funding_supported','selective')
GATES={'all_stress_segments_positive':True,'worst_severe_segment_min':-.05,'worst_extreme_segment_min':-.08,'prefinal_cagr_min':.03,'prefinal_max_drawdown_min':-.12,'prefinal_turnover_max':10.}
@njit(cache=True)
def rolling_stats(x,look):
 n,m=x.shape;mean=np.empty((n,m));std=np.empty((n,m));mean[:]=np.nan;std[:]=np.nan
 for i in range(n):
  if i+1<look:continue
  a=i+1-look
  for j in range(m):
   s=0.;ss=0.;c=0
   for q in range(a,i+1):
    v=x[q,j]
    if np.isfinite(v):s+=v;ss+=v*v;c+=1
   if c>=look//2:
    mu=s/c;va=max(0.,ss/c-mu*mu);mean[i,j]=mu;std[i,j]=np.sqrt(va)
 return mean,std
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
def variant(basis,z,expected,vol,avail,entry_z,exit_z,basis_floor,fund_min,top_k,pair_gross,reb,mode):
 n,m=basis.shape;out=np.zeros((n,m));cur=np.zeros(m);last=-10**9
 for i in range(n):
  for j in range(m):
   if cur[j]>0 and ((not avail[i,j]) or not np.isfinite(z[i,j]) or z[i,j]<=exit_z or basis[i,j]<=0 or not np.isfinite(expected[i,j]) or expected[i,j]<0):cur[j]=0.
  if i-last<reb:out[i]=cur;continue
  ids=np.empty(m,np.int64);scores=np.empty(m);k=0
  for j in range(m):
   if avail[i,j] and np.isfinite(z[i,j]) and z[i,j]>=entry_z and np.isfinite(basis[i,j]) and basis[i,j]>=basis_floor and np.isfinite(expected[i,j]) and expected[i,j]>=fund_min:
    ids[k]=j;scores[k]=z[i,j]*max(basis[i,j],1e-8)+.25*expected[i,j];k+=1
  chosen=np.empty(min(top_k,k),np.int64);sv=np.empty(min(top_k,k));cnt=0
  for u in range(min(top_k,k)):
   bi=-1;bv=-1e99
   for q in range(k):
    used=False
    for v in range(cnt):
     if ids[q]==chosen[v]:used=True;break
    if not used and scores[q]>bv:bi=q;bv=scores[q]
   if bi>=0:chosen[cnt]=ids[bi];sv[cnt]=max(bv,1e-8);cnt+=1
  cur[:]=0.
  if cnt>0:
   leg=pair_gross/2.;den=0.
   for u in range(cnt):
    j=chosen[u];den+=(1. if mode==0 else sv[u] if mode==1 else 1./max(vol[i,j],1e-4))
   for u in range(cnt):
    j=chosen[u];w=(1. if mode==0 else sv[u] if mode==1 else 1./max(vol[i,j],1e-4));cur[j]=leg*w/den
  last=i;out[i]=cur
 return out

def build_families(m):
 basis=(m.perp_close/m.spot_close-1.).to_numpy(float);fund=m.funding.to_numpy(float);ret=m.spot_close.pct_change(fill_method=None);vol=(ret.rolling(90,min_periods=45).std()*np.sqrt(365*3)).to_numpy(float);av=m.available.to_numpy(bool);expected={x:rollmean(fund,x)*365*3 for x in (9,21,42)};shape=basis.shape
 zmap={}
 for l in (21,63,126):
  mu,sd=rolling_stats(basis,l);zmap[l]=(basis-mu)/np.where(sd>1e-8,sd,np.nan)
 specs={
  'fast_dislocation':[(l,e,x,b,f,k,g,r,mo) for l in (21,63) for e in (2.,3.) for x in (.25,.75) for b in (.001,.002) for f in (.05,.10) for k in (1,2) for g in (.15,.25) for r in (1,3) for mo in (0,1)],
  'slow_convergence':[(l,e,x,b,f,k,g,r,mo) for l in (63,126) for e in (1.5,2.) for x in (.25,.75) for b in (.001,.002) for f in (.05,.10) for k in (2,3) for g in (.20,.30) for r in (3,9) for mo in (0,2)],
  'funding_supported':[(l,e,x,b,f,k,g,r,mo) for l in (21,63) for e in (1.5,2.5) for x in (.25,.5) for b in (.001,) for f in (.10,.20) for k in (1,2) for g in (.15,.25) for r in (1,3) for mo in (1,)],
  'selective':[(l,e,x,b,f,k,g,r,mo) for l in (63,126) for e in (2.5,3.) for x in (.5,1.) for b in (.002,.004) for f in (.10,.20) for k in (1,) for g in (.15,.25) for r in (3,9) for mo in (1,)],
 }
 out={};counts={}
 for name,sp in specs.items():
  acc=np.zeros(shape)
  for l,e,x,b,f,k,g,r,mo in sp:acc+=variant(basis,zmap[l],expected[21 if name=='slow_convergence' else 9 if name=='fast_dislocation' else 42],vol,av,e,x,b,f,k,g,r,mo)
  out[name]=pd.DataFrame(acc/len(sp),index=m.index,columns=m.symbols);counts[name]=len(sp)
 return out,counts

def processes(f):return {'+'.join(s):sum(f[x] for x in s)/len(s) for n in range(1,5) for s in combinations(FAMILIES,n)}
def simulate(m,s,start,end,bps):
 a=int(m.index.searchsorted(pd.Timestamp(start,tz='UTC')));b=int(m.index.searchsorted(pd.Timestamp(end,tz='UTC')));v=simulate_numba(m.spot_open.to_numpy(float),m.spot_close.to_numpy(float),m.perp_open.to_numpy(float),m.perp_close.to_numpy(float),m.funding.to_numpy(float),m.available.to_numpy(bool),s.reindex(m.index).fillna(0).to_numpy(float),a,b,bps/10000.,.01,1.,10000.)
 return pd.DataFrame({'equity':v[0],'gross':v[1],'turnover':v[2],'costs':v[3],'funding_pnl':v[4]},index=m.index[a:b])
def main():
 p=argparse.ArgumentParser();p.add_argument('--cache',type=Path);p.add_argument('--output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);m,_,_=load(Config(),a.cache);fam,counts=build_families(m);procs=processes(fam);rows=[]
 for name,sig in procs.items():
  for scen in ('stress','severe','extreme'):
   for per in ('prefinal',*PREFINAL_PERIODS):rows.append({'candidate':name,'scenario':scen,'period':per,**metrics(simulate(m,sig,*PERIODS[per],COSTS_BPS[scen]))})
 df=pd.DataFrame(rows);rank=[]
 for name in procs:
  z=df[df.candidate==name];pr=z[(z.scenario=='stress')&(z.period=='prefinal')].iloc[0];sg=z[(z.scenario=='stress')&z.period.isin(PREFINAL_PERIODS)];se=z[(z.scenario=='severe')&z.period.isin(PREFINAL_PERIODS)];ex=z[(z.scenario=='extreme')&z.period.isin(PREFINAL_PERIODS)];ok=bool((sg.total_return>0).all() and se.total_return.min()>GATES['worst_severe_segment_min'] and ex.total_return.min()>GATES['worst_extreme_segment_min'] and pr.annualized_return>=GATES['prefinal_cagr_min'] and pr.max_drawdown>=GATES['prefinal_max_drawdown_min'] and pr.annual_turnover<=GATES['prefinal_turnover_max']);rank.append({'candidate':name,'eligible_before_final':ok,'score':process_score(z),'prefinal_cagr':pr.annualized_return,'prefinal_dd':pr.max_drawdown,'turnover':pr.annual_turnover,'worst_stress':sg.total_return.min(),'worst_severe':se.total_return.min(),'worst_extreme':ex.total_return.min()})
 ranking=pd.DataFrame(rank).sort_values(['eligible_before_final','score'],ascending=False);ranking.to_csv(a.output/'selection_before_final.csv',index=False);sel=ranking[ranking.eligible_before_final].iloc[0] if ranking.eligible_before_final.any() else ranking.iloc[0];name=str(sel.candidate);proof={'candidate':'ACTIVE_V36_BASIS_CONVERGENCE','selection_uses_2021_2025_only':True,'gates':GATES,'families':counts,'process_count':len(procs),'ranking':ranking.to_dict(orient='records'),'selected':name,'selected_eligible':bool(sel.eligible_before_final)};(a.output/'selection_proof_before_final.json').write_text(json.dumps(proof,indent=2));ph=hashlib.sha256((a.output/'selection_proof_before_final.json').read_bytes()).hexdigest()
 for scen,bps in COSTS_BPS.items():
  for per in ('full','final_2026h1'):rows.append({'candidate':name,'scenario':scen,'period':per,**metrics(simulate(m,procs[name],*PERIODS[per],bps))})
 df=pd.DataFrame(rows);df.to_csv(a.output/'metrics.csv',index=False);get=lambda s,p:df[(df.candidate==name)&(df.scenario==s)&(df.period==p)].iloc[-1];full=get('stress','full');fin=get('stress','final_2026h1');status='frozen_paper_forward_candidate' if bool(sel.eligible_before_final) and fin.total_return>0 and get('severe','final_2026h1').total_return>0 else 'rejected_or_needs_iteration';summary={'candidate':'ACTIVE_V36_BASIS_CONVERGENCE','status':status,'selected_process':name,'selection_proof_sha256':ph,'selection_excludes_2026h1':True,'selected_eligible_before_final':bool(sel.eligible_before_final),'prefinal':{k:float(sel[k]) for k in ('prefinal_cagr','prefinal_dd','turnover','worst_stress','worst_severe','worst_extreme')},'stress_full':{k:float(full[k]) for k in ('annualized_return','total_return','max_drawdown','sharpe','annual_turnover','average_gross','max_gross','funding_pnl','costs')},'stress_final_2026h1':{k:float(fin[k]) for k in ('annualized_return','total_return','max_drawdown','sharpe','annual_turnover','average_gross','max_gross','funding_pnl','costs')},'strict_costs':{s:{'full_cagr':float(get(s,'full').annualized_return),'full_return':float(get(s,'full').total_return),'full_dd':float(get(s,'full').max_drawdown),'final_return':float(get(s,'final_2026h1').total_return)} for s in COSTS_BPS}};(a.output/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
