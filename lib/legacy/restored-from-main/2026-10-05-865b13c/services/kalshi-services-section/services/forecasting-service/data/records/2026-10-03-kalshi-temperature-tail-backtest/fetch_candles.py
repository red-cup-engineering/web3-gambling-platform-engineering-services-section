import json, urllib.request, urllib.parse, time, os, sys, calendar, glob, collections
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
B="https://api.elections.kalshi.com/trade-api/v2"
def get(url):
    for i in range(6):
        try:
            time.sleep(0.08)
            return json.loads(urllib.request.urlopen(urllib.request.Request(url,headers={"accept":"application/json"}),timeout=60).read())
        except urllib.error.HTTPError as e:
            if e.code==429 or e.code>=500: time.sleep(2**i); continue
            print("HTTP",e.code,e.read()[:200],file=sys.stderr); raise
    raise RuntimeError(url)
MON={m:i for i,m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(),1)}
event_key=lambda d: f"20{d[:2]}-{MON[d[2:5]]:02d}-{d[5:]}"
bydate=collections.defaultdict(list)
for f in glob.glob("markets/*.json"):
    for m in json.load(open(f)): bydate[m["event_ticker"].split("-")[1]].append(m)
OUT=sys.argv[3] if len(sys.argv)>3 else "candles.json"
LO,HI=(sys.argv[1],sys.argv[2]) if len(sys.argv)>2 else ("","ZZZ")
out={} if not os.path.exists(OUT) else json.load(open(OUT))
for d,ms in sorted(bydate.items(), key=lambda kv: event_key(kv[0])):
    if not (LO<=str(event_key(d))<=HI): continue
    ms=[m for m in ms if m["ticker"] not in out]
    for i in range(0,len(ms),50):
        ch=ms[i:i+50]
        st=min(ts(m["open_time"]) for m in ch); en=max(ts(m["close_time"]) for m in ch)
        r=get(B+"/markets/candlesticks?"+urllib.parse.urlencode(dict(market_tickers=",".join(m["ticker"] for m in ch),start_ts=st,end_ts=en,period_interval=60)))
        for mk in r.get("markets",[]): out[mk["market_ticker"]]=mk["candlesticks"]
    print(d,len(out),file=sys.stderr)
    json.dump(out,open(OUT,"w"))
