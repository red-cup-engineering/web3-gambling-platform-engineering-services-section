import urllib.request, time, os, sys, json
UA={"user-agent":"561-group weather desk research (ops@561.group)"}
st=sorted({l.split()[1] for l in open("series.txt")})
os.makedirs("cli",exist_ok=True); os.makedirs("nbs",exist_ok=True)
def get(url):
    for i in range(8):
        time.sleep(6)
        try:
            b=urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=120).read()
            if b.startswith(b"Too many"): time.sleep(30*(i+1)); continue
            return b
        except Exception as e: print("retry",url,e,file=sys.stderr); time.sleep(20*(i+1))
    raise RuntimeError(url)
for c in st:
    icao="K"+c
    p=f"cli/{icao}.json"
    if not os.path.exists(p): open(p,"wb").write(get(f"https://mesonet.agron.iastate.edu/json/cli.py?station={icao}&year=2026")); print("cli",icao,file=sys.stderr)
    p=f"nbs/{icao}.csv"
    if not os.path.exists(p) or os.path.getsize(p)<1000:
        open(p,"wb").write(get(f"https://mesonet.agron.iastate.edu/cgi-bin/request/mos.py?station={icao}&model=NBS&sts=2026-07-28T00:00Z&ets=2026-10-03T18:00Z&format=csv")); print("nbs",icao,os.path.getsize(p),file=sys.stderr)
