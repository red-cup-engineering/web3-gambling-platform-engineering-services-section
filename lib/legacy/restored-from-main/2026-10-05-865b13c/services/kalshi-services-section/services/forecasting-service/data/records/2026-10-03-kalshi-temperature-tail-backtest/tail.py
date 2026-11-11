import pickle,sys,os
from common import *
params,samples=pickle.load(open(sys.argv[1],"rb"))
a,s0,s1,nu,bias=params["a"],params["s0"],params["s1"],params["nu"],params["bias"]
TAU=float(os.environ.get("TAU","0"))
sig=lambda xnd,lead: math.sqrt((a*xnd)**2+(s0+s1*max(lead-12,0)/24)**2+TAU**2)
rows=[]
for x in samples:
    mu=x["txn"]+bias.get(x["icao"],0); sg=sig(x["xnd"],x["lead"])
    for q in x["quotes"]:
        if not (0<q["bid"]<q["ask"]<1): continue
        rows.append(dict(win="aug" if x["date"]<dt.date(2026,9,4) else "sep",lab=x["lab"],s=x["s"],tk=q["m"]["ticker"],date=x["date"],p=prob(q["m"],mu,sg,nu),bid=q["bid"],ask=q["ask"],out=q["out"],futhi=q["futhi"],dist=None))
for X,Y in ((0.05,0.005),(0.05,0.01),(0.08,0.005),(0.10,0.005),(0.10,0.002)):
  for win in ("aug","sep"):
    R=[r for r in rows if r["win"]==win and r["ask"]<=X and r["p"]<=Y]
    mk=[r["ask"]-r["out"] for r in R if r["futhi"] is not None and r["futhi"]>=r["ask"]]
    dm={r["tk"] for r in R}; lost={r["tk"] for r in R if r["out"]==1}
    print(f"ask<={X:.2f} p<={Y:.3f} {win}: quotes={len(R):4} markets={len(dm):4} lost_markets={len(lost)} {sorted(lost)[:4]} taker={np.mean([r['bid']-r['out']-0.002 for r in R]) if R else 0:+.4f} maker_fills={len(mk)} maker={np.mean(mk) if mk else 0:+.4f} days={len({r['date'] for r in R})} cities={len({r['s'] for r in R})}")
print()
R=[r for r in rows if r["ask"]<=0.05 and r["p"]<=0.005]
by=collections.Counter(r["lab"] for r in R); print("by decision time",dict(by))
by=collections.Counter(r["s"] for r in R); print("by city",dict(by.most_common()))
# per-day opportunity count (distinct markets at D-1 15h or D 07h)
per=collections.Counter(r["date"] for r in R if r["lab"] in ("D-1 15h","D 07h")); print("markets/day mean",np.mean(list(per.values())),"days",len(per))
