import pickle,sys
from common import *
from scipy.optimize import minimize
params,samples=pickle.load(open(sys.argv[1] if len(sys.argv)>1 else "model-high.pkl","rb"))
FIT_END=dt.date.fromisoformat(sys.argv[2]) if len(sys.argv)>2 else dt.date(2026,9,4)
a,s0,s1,nu,bias=params["a"],params["s0"],params["s1"],params["nu"],params["bias"]
sig=lambda xnd,lead: math.sqrt((a*xnd)**2+(s0+s1*max(lead-12,0)/24)**2)
L=lambda p: math.log(min(max(p,0.003),0.997)/(1-min(max(p,0.003),0.997)))
rows=[]
for x in samples:
    mu=x["txn"]+bias.get(x["icao"],0); sg=sig(x["xnd"],x["lead"])
    for q in x["quotes"]:
        if not (0<q["bid"]<q["ask"]<1) or q["ask"]-q["bid"]>0.10: continue   # two-sided, not stale-wide
        p=prob(q["m"],mu,sg,nu); mid=(q["bid"]+q["ask"])/2
        rows.append(dict(fit=x["date"]<FIT_END,lab=x["lab"],date=x["date"],p=p,mid=mid,bid=q["bid"],ask=q["ask"],out=q["out"],futlo=q["futlo"],futhi=q["futhi"],lm=L(mid),lp=L(p)))
F=[r for r in rows if r["fit"]]; T=[r for r in rows if not r["fit"]]
print("fit quotes",len(F),"test quotes",len(T))
def nll(w,R):
    z=np.array([w[0]+w[1]*r["lm"]+w[2]*r["lp"] for r in R]); y=np.array([r["out"] for r in R])
    pr=1/(1+np.exp(-z)); return -np.mean(y*np.log(pr+1e-12)+(1-y)*np.log(1-pr+1e-12))
w=minimize(nll,[0,1,0],args=(F,)).x
w_m=minimize(lambda v: nll([v[0],v[1],0],F),[0,1]).x
print("pooled weights c=%.3f market=%.3f model=%.3f"%tuple(w), " market-only recal c=%.3f w=%.3f"%tuple(w_m))
for lab in sorted({r["lab"] for r in T}):
    R=[r for r in T if r["lab"]==lab]
    print(f"test {lab:8} n={len(R):5} logloss mid={nll([0,1,0],R):.4f} recal-mid={nll([w_m[0],w_m[1],0],R):.4f} pooled={nll(w,R):.4f} model={nll([0,0,1],R):.4f}")
pool=lambda r: 1/(1+math.exp(-(w[0]+w[1]*r["lm"]+w[2]*r["lp"])))
print("\nMAKER on pooled p (join-improve by 1c; filled if a later trade at or through our price within 6h)")
for lab in sorted({r["lab"] for r in T}):
  for th in (0.02,0.03,0.05,0.08):
    pnl=[]
    for r in T:
        if r["lab"]!=lab or r["futlo"] is None: continue
        pp=pool(r); py=round(r["bid"]+0.01,2); pn=round(r["ask"]-0.01,2)
        if py<r["ask"] and pp-py>=th and r["futlo"]<=py: pnl.append(r["out"]-py)
        elif pn>r["bid"] and pn-pp>=th and r["futhi"]>=pn: pnl.append(pn-r["out"])
    if pnl: print(f"  {lab:8} th={th:.2f} fills={len(pnl):4} mean={np.mean(pnl):+.4f} total={sum(pnl):+7.2f} se={np.std(pnl)/math.sqrt(len(pnl)):.4f}")
print("\nTAIL: sell YES (buy NO) where ask<=X and model p<=Y; taker at 1-bid incl. fee on a 10-lot, and maker at ask filled if a later trade >= ask")
for X in (0.02,0.03,0.05):
  for Y in (0.002,0.005,0.01,0.02):
    tk=[];mk=[]
    for r in T:
        if r["ask"]>X or r["p"]>Y: continue
        f=math.ceil(0.07*10*(1-r["bid"])*r["bid"]*100-1e-9)/100/10
        tk.append(r["bid"]-r["out"]-f)
        if r["futhi"] is not None and r["futhi"]>=r["ask"]: mk.append(r["ask"]-r["out"])
    if tk: print(f"  ask<={X:.2f} p<={Y:.3f} n={len(tk):4} yesrate={np.mean([0]+[1 for _ in []]) if False else ''} taker mean={np.mean(tk):+.4f} | maker fills={len(mk):4} mean={(np.mean(mk) if mk else 0):+.4f}  losses={sum(1 for v in tk if v<-0.5)}")
