from common import *
cli=load_cli()
agree=dis=miss=0; bad=[]
for s,c in SERIES.items():
    for m in json.load(open(f"markets/{s}.json")):
        if m.get("result") not in ("yes","no"): continue
        d=event_date(m["event_ticker"]); v=cli.get(("K"+c,d.isoformat()))
        if not v: miss+=1; continue
        k=v[0] if KIND[s]=="high" else v[1]
        o=outcome(m,k)
        if o==(m["result"]=="yes"): agree+=1
        else: dis+=1; bad.append((m["ticker"],k,m["strike_type"],m.get("floor_strike"),m.get("cap_strike"),m["result"]))
print("agree",agree,"disagree",dis,"missing cli",miss)
for b in bad[:25]: print(b)
