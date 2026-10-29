import json, csv, glob, calendar, time, re, math, collections, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np
from scipy import stats
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
TZ={"NYC":"America/New_York","PHL":"America/New_York","ATL":"America/New_York","BOS":"America/New_York","DCA":"America/New_York","EWR":"America/New_York","MIA":"America/New_York","TTN":"America/New_York","SDF":"America/Kentucky/Louisville",
    "MDW":"America/Chicago","DFW":"America/Chicago","HOU":"America/Chicago","MSP":"America/Chicago","MSY":"America/Chicago","OKC":"America/Chicago","SAT":"America/Chicago","AUS":"America/Chicago",
    "DEN":"America/Denver","PHX":"America/Phoenix","LAS":"America/Los_Angeles","LAX":"America/Los_Angeles","SAN":"America/Los_Angeles","SEA":"America/Los_Angeles","SFO":"America/Los_Angeles"}
SERIES={s:c for s,c in (l.split() for l in open("series.txt"))}
KIND={s:("high" if s.startswith("KXHIGH") else "low") for s in SERIES}
MON={m:i for i,m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(),1)}
def event_date(ev):
    m=re.search(r"-(\d\d)([A-Z]{3})(\d\d)$",ev); return dt.date(2000+int(m.group(1)),MON[m.group(2)],int(m.group(3)))
def load_cli():
    out={}
    for f in glob.glob("cli/*.json"):
        icao=f.split("/")[-1][:-5]
        try: rows=json.load(open(f))["results"]
        except Exception: continue
        for r in rows:
            if isinstance(r.get("high"),(int,float)) and isinstance(r.get("low"),(int,float)):
                out[(icao,r["valid"])]=(r["high"],r["low"])
    return out
def load_nbs():
    out=collections.defaultdict(dict)  # icao -> runtime_ts -> {ftime_ts:(txn,xnd)}
    for f in glob.glob("nbs/*.csv"):
        icao=f.split("/")[-1][:-4]
        for r in csv.DictReader(open(f)):
            if r.get("txn") in ("",None): continue
            rt=ts(r["runtime"].replace(" ","T")); ft=ts(r["ftime"].replace(" ","T"))
            out[icao].setdefault(rt,{})[ft]=(float(r["txn"]),float(r["xnd"]) if r["xnd"] else float("nan"))
    return out
def outcome(m,k):
    st=m["strike_type"]; f=m.get("floor_strike"); c=m.get("cap_strike")
    if st=="less": return int(k<=c-1) if c is not None else None
    if st=="greater": return int(k>=f+1)
    if st=="between": return int(f<=k<=c)
    return None
def bracket_cdf_bounds(m):
    st=m["strike_type"]; f=m.get("floor_strike"); c=m.get("cap_strike")
    if st=="less": return (-math.inf, c-0.5)
    if st=="greater": return (f+0.5, math.inf)
    return (f-0.5, c+0.5)
def prob(m, mu, sigma, nu):
    lo,hi=bracket_cdf_bounds(m)
    F=lambda x: 0.0 if x==-math.inf else 1.0 if x==math.inf else stats.t.cdf((x-mu)/sigma, nu)
    return F(hi)-F(lo)
def local_ts(date, hour, tz, day_offset=0):
    d=date+dt.timedelta(days=day_offset)
    return int(dt.datetime(d.year,d.month,d.day,hour,tzinfo=ZoneInfo(tz)).timestamp())
def nbm_at(nbs_icao, t, target_ft, lag=2*3600):
    best=None
    for rt,rows in nbs_icao.items():
        if rt+lag<=t and target_ft in rows and (best is None or rt>best[0]): best=(rt,rows[target_ft])
    return best
def target_ftime(date, kind):
    if kind=="high": d=date+dt.timedelta(days=1); return calendar.timegm((d.year,d.month,d.day,0,0,0))
    return calendar.timegm((date.year,date.month,date.day,12,0,0))
