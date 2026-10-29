import sys, pickle
from common import *
params,samples=pickle.load(open(sys.argv[1],"rb"))
SPLIT=dt.date(2026,9,4)
a,s0,s1,nu,bias=params["a"],params["s0"],params["s1"],params["nu"],params["bias"]
def sig(xnd,lead): return math.sqrt((a*xnd)**2+(s0+s1*max(lead-12,0)/24)**2)
fee=lambda p: math.ceil(0.07*p*(1-p)*100-1e-9)/100  # per 1-contract taker order, cent-rounded
fee_c=lambda p,n: math.ceil(0.07*n*p*(1-p)*100-1e-9)/100
rows=[]
for x in samples:
    mu=x["txn"]+bias.get(x["icao"],0); sg=sig(x["xnd"],x["lead"])
    for q in x["quotes"]:
        if not (0<q["bid"]<q["ask"]<1): continue
        p=prob(q["m"],mu,sg,nu)
        rows.append(dict(set="fit" if x["date"]<SPLIT else "test",lab=x["lab"],s=x["s"],p=p,bid=q["bid"],ask=q["ask"],mid=(q["bid"]+q["ask"])/2,out=q["out"],futlo=q["futlo"],futhi=q["futhi"],date=x["date"]))
def brier(ps,os_): return float(np.mean([(p-o)**2 for p,o in zip(ps,os_)]))
def logl(ps,os_): return float(np.mean([-math.log(max(p if o else 1-p,1e-4)) for p,o in zip(ps,os_)]))
for st in ("fit","test"):
  for lab in sorted({r["lab"] for r in rows}):
    R=[r for r in rows if r["set"]==st and r["lab"]==lab]
    if not R: continue
    o=[r["out"] for r in R]
    print(f"{st:4} {lab:8} n={len(R):5} brier model={brier([r['p'] for r in R],o):.4f} market={brier([r['mid'] for r in R],o):.4f} | logloss model={logl([r['p'] for r in R],o):.4f} market={logl([r['mid'] for r in R],o):.4f}")
print()
# taker simulation: buy YES at ask if p-ask-fee>=th ; buy NO at (1-bid) if (1-p)-(1-bid)-fee>=th, 1 contract
for st in ("test",):
  for lab in sorted({r["lab"] for r in rows}):
    for th in (0.03,0.05,0.08,0.10,0.15,0.20):
      pnl=[];
      for r in rows:
        if r["set"]!=st or r["lab"]!=lab: continue
        ey=r["p"]-r["ask"]-fee(r["ask"]); en=(1-r["p"])-(1-r["bid"])-fee(1-r["bid"])
        if ey>=th and ey>=en: pnl.append(r["out"]-r["ask"]-fee(r["ask"]))
        elif en>=th: pnl.append((1-r["out"])-(1-r["bid"])-fee(1-r["bid"]))
      if pnl: print(f"TAKER {st} {lab:8} th={th:.2f} trades={len(pnl):4} mean={np.mean(pnl):+.4f} total={sum(pnl):+7.2f} win={np.mean([v>0 for v in pnl]):.2f}")
print()
# maker simulation: rest a YES bid at min(bid+.01, p-th) if >= bid+.01 ... filled if trade price later <= our price (strict <, conservative) ; NO side symmetric
for st in ("test",):
  for lab in sorted({r["lab"] for r in rows}):
    for th in (0.03,0.05,0.08,0.10,0.15):
      pnl=[]
      for r in rows:
        if r["set"]!=st or r["lab"]!=lab or r["futlo"] is None: continue
        py=round(r["bid"]+0.01,2)
        if py<r["ask"] and r["p"]-py>=th and r["futlo"]<py: pnl.append(r["out"]-py); continue
        pn=round(r["ask"]-0.01,2)  # sell YES at ask-1c == buy NO at 1-pn
        if pn>r["bid"] and pn-r["p"]>=th and r["futhi"]>pn: pnl.append(pn-r["out"])
      if pnl: print(f"MAKER {st} {lab:8} th={th:.2f} fills={len(pnl):4} mean={np.mean(pnl):+.4f} total={sum(pnl):+7.2f} win={np.mean([v>0 for v in pnl]):.2f}")
