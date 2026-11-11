import sys, pickle
from common import *
from scipy.optimize import minimize
cli=load_cli(); nbs=load_nbs(); candles=json.load(open("candles.json"))
import os
SPLIT=dt.date.fromisoformat(os.environ.get("SPLIT","2026-09-04"))
KINDS=sys.argv[1].split(",") if len(sys.argv)>1 else ["high"]
# decision times: (label, day_offset, local hour)
DEC={"high":[("D-1 15h",-1,15),("D-1 21h",-1,21),("D 07h",0,7),("D 10h",0,10)],
     "low":[("D-1 15h",-1,15),("D-1 21h",-1,21)]}
# ---- samples: one per (series, date, decision) with the NBM guidance as of then
events=collections.defaultdict(list)
for s,c in SERIES.items():
    if KIND[s] not in KINDS: continue
    for m in json.load(open(f"markets/{s}.json")):
        if m.get("result") in ("yes","no"): events[(s,m["event_ticker"])].append(m)
samples=[]
for (s,ev),ms in events.items():
    c=SERIES[s]; icao="K"+c; tz=TZ[c]; kind=KIND[s]; d=event_date(ev)
    truth=cli.get((icao,d.isoformat()))
    if not truth or icao not in nbs: continue
    k=truth[0] if kind=="high" else truth[1]
    ft=target_ftime(d,kind)
    for lab,off,hr in DEC[kind]:
        t=local_ts(d,hr,tz,off)
        g=nbm_at(nbs[icao],t,ft)
        if not g: continue
        rt,(txn,xnd)=g
        quotes=[]
        for m in ms:
            cs=[x for x in candles.get(m["ticker"],[]) if x["end_period_ts"]<=t]
            if not cs: continue
            x=cs[-1]
            b=float(x["yes_bid"]["close_dollars"] or 0); a=float(x["yes_ask"]["close_dollars"] or 0)
            # later price path for maker fill simulation: min/max trade price in next 6h
            fut=[y for y in candles.get(m["ticker"],[]) if t<y["end_period_ts"]<=t+6*3600 and y["price"].get("low_dollars")]
            lo=min((float(y["price"]["low_dollars"]) for y in fut),default=None); hi=max((float(y["price"]["high_dollars"]) for y in fut),default=None)
            quotes.append(dict(m=m,bid=b,ask=a,out=int(m["result"]=="yes"),cliout=outcome(m,k),futlo=lo,futhi=hi,oi=float(x.get("open_interest_fp") or 0)))
        samples.append(dict(s=s,icao=icao,date=d,lab=lab,t=t,rt=rt,lead=(ft-rt)/3600,txn=txn,xnd=xnd,k=k,quotes=quotes,kind=kind))
print("samples",len(samples),file=sys.stderr)
stations=sorted({x["icao"] for x in samples}); sidx={s:i for i,s in enumerate(stations)}
fit=[x for x in samples if x["date"]<SPLIT]; test=[x for x in samples if x["date"]>=SPLIT]
def unpack(th):
    a,s0,s1,lnu=th[:4]; return a,s0,s1,math.exp(lnu)+2,th[4:]
def sig(a,s0,s1,xnd,lead): return math.sqrt((a*xnd)**2+(s0+s1*max(lead-12,0)/24)**2)
def arrays(data):
    return (np.array([x["txn"] for x in data]),np.array([x["xnd"] for x in data]),np.array([x["lead"] for x in data]),np.array([x["k"] for x in data]),np.array([sidx[x["icao"]] for x in data]))
FA=None
def nll(th,data):
    global FA
    if FA is None: FA=arrays(data)
    txn,xnd,lead,k,si=FA
    a,s0,s1,nu,b=unpack(th)
    if s0<=0.2: return 1e9
    mu=txn+np.asarray(b)[si]; sg=np.sqrt((a*xnd)**2+(s0+s1*np.maximum(lead-12,0)/24)**2)
    p=stats.t.cdf((k+0.5-mu)/sg,nu)-stats.t.cdf((k-0.5-mu)/sg,nu)
    return float(-np.log(np.maximum(p,1e-9)).sum()+0.5*np.sum(np.asarray(b)**2))
th0=np.array([0.5,1.5,0.3,math.log(4)]+[0.0]*len(stations))
r=minimize(nll,th0,args=(fit,),method="L-BFGS-B",options=dict(maxiter=300))
a,s0,s1,nu,b=unpack(r.x)
print(f"fit nll/n={r.fun/len(fit):.3f} a={a:.2f} s0={s0:.2f} s1={s1:.2f} nu={nu:.1f}",file=sys.stderr)
print("bias",{s:round(b[sidx[s]],2) for s in stations},file=sys.stderr)
params=dict(a=a,s0=s0,s1=s1,nu=nu,bias={s:float(b[sidx[s]]) for s in stations})
pickle.dump((params,samples),open(f"model-{'-'.join(KINDS)}.pkl","wb"))
