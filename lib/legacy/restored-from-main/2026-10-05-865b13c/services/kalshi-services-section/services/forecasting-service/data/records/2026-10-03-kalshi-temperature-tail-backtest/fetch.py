import json, urllib.request, urllib.parse, time, os, sys, csv, io, calendar
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
B="https://api.elections.kalshi.com/trade-api/v2"
UA={"accept":"application/json","user-agent":"561-group weather desk research (ops@561.group)"}
def get(url, tries=6, pace=0.06):
    for i in range(tries):
        try:
            time.sleep(pace)
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504): time.sleep(2**i); continue
            raise
        except Exception: time.sleep(2**i)
    raise RuntimeError(url)
def kget(path, **q): return json.loads(get(B+path+"?"+urllib.parse.urlencode(q)))
SERIES={}
for s,cli in [l.split() for l in open("series.txt")]: SERIES[s]=cli
os.makedirs("markets",exist_ok=True); os.makedirs("candles",exist_ok=True)
MIN_CLOSE=ts("2026-08-05T00:00:00")
for s in SERIES:
    out=f"markets/{s}.json"
    if os.path.exists(out): continue
    rows=[];cur=""
    while True:
        q=dict(series_ticker=s,status="settled",limit=1000,min_close_ts=MIN_CLOSE)
        if cur:q["cursor"]=cur
        d=kget("/markets",**q); rows+=d.get("markets",[]); cur=d.get("cursor")
        if not cur: break
    json.dump(rows,open(out,"w")); print(s,len(rows),file=sys.stderr)
# candles: batch by 100 tickers, per event window
for s in SERIES:
    out=f"candles/{s}.json"
    if os.path.exists(out): continue
    ms=json.load(open(f"markets/{s}.json")); res={}
    for i in range(0,len(ms),60):
        chunk=ms[i:i+60]
        st=min(ts(m["open_time"]) for m in chunk)
        en=max(ts(m["close_time"]) for m in chunk)
        d=json.loads(get(B+"/markets/candlesticks?"+urllib.parse.urlencode(dict(market_tickers=",".join(m["ticker"] for m in chunk),start_ts=st,end_ts=en,period_interval=60))))
        for mk in d.get("markets",[]): res[mk["market_ticker"]]=mk["candlesticks"]
    json.dump(res,open(out,"w")); print("candles",s,len(res),file=sys.stderr)
