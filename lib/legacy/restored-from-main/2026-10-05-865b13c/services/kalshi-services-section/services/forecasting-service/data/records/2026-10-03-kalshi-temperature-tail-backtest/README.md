# Kalshi daily-temperature backtest, 2026-10-03

The evidence behind `content/config/temperature-markets.json` (the fitted model) and the
Kalshi stake path's `weather-desk-policy.json` (the tail-premium strategy). The data is not
kept here (about 1 GB); the scripts re-fetch it from public sources.

## Data

- Kalshi: every settled market of the 48 `KXHIGH*`/`KXLOWT*` series with close after
  2026-08-05 (`fetch.py`), and their hourly candlesticks (`fetch_candles.py`, batched by
  event date, at most 50 tickers a call).
- IEM: NBM NBS station guidance for the 24 settlement stations, runs 00/06/12/18Z
  (`fetch_iem.py`, paced; IEM throttles), and the NWS Daily Climate Reports for 2026.

## Steps and results

1. `validate.py`: the bracket reading (`less X` is K <= X-1, `between a b` is a <= K <= b,
   `greater X` is K >= X+1) against Kalshi's results: 12,682 of 12,684 agree. The two that
   do not are one Miami day where the climate report IEM holds (85) is not what Kalshi
   settled on (90-91): settlement-source error is a real, rare tail.
2. `backtest.py <high|low>`: for each event and decision time (day before 15h and 21h
   local; for highs also the day itself 07h and 10h), the newest NBM run issued at least two
   hours earlier and the last closed hourly candle. Fits a location-scale Student-t over
   TXN + station bias with scale sqrt((a*XND)^2 + (s0 + s1*lead)^2) by maximum likelihood
   on dates before `SPLIT` (default 2026-09-04).
3. `evaluate.py`: out of sample (09-04..10-02) the model LOSES to Kalshi's mid at every
   decision time (Brier 0.138-0.164 vs 0.119-0.130). Trading it against the market loses
   4-6c a contract taking and 1-5c resting.
4. `pool.py`: logistic pooling of market and model log-odds gives the model weight 0.125
   and no out-of-sample gain. NBM carries nothing the market has not priced.
5. `tail.py` (with `TAU=0.6`, the station-bias uncertainty the production model adds):
   the market's cheapest brackets are overpriced, and the model certifies which ones are
   truly far tails. Scored on Kalshi's own results:

   | set | markets | settled yes | resting sell, per contract | taking, per contract |
   | --- | --- | --- | --- | --- |
   | high, ask <= 0.05, model p <= 0.01, Aug | 150 | 0 | +2.6c (139 fills) | +1.2c |
   | high, same, Sep (out of sample) | 272 | 0 | +2.7c (244 fills) | +1.2c |
   | low, ask <= 0.05, model p <= 0.005, Aug | 253 | 1 | +3.5c (76 fills) | +0.9c |
   | low, same, Sep (out of sample) | 195 | 0 | +3.6c (33 fills) | +1.1c |

   A resting sell is counted filled only if a later trade printed at or through its price
   within six hours. The taking column charges Kalshi's fee on a 10-lot.

## What it does not show

Two months, one season (late summer into fall). Station biases moved up to 1.3F between
the halves. The loss rate is bounded, not measured: 0 of 422 high tails gives a 95% upper
bound near 0.7%, which is why the desk sizes on a 1% floor (1.2% for lows). The desk's
falsifier halt (three certified tails settled yes in 30 days) is this record's live test.
