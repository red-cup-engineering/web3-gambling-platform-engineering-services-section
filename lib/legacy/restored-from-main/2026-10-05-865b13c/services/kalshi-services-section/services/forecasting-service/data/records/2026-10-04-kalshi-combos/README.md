# Kalshi combo (KXMVECROSSCATEGORY*) shadow lane, 2026-10-04

Shadow only. Everything here is read-only GETs through the kalshi-services-section client.
No RFQ or quote is ever created, accepted, confirmed or deleted; no order is placed.

## What is in the lane

| file | role |
| --- | --- |
| `src/combo-pricer.mjs` | pure: normal cdf/inverse, Genz orthant MVN probability, leg-role parsing (`legMeta`, `teamSide`, `pairClass`), exclusive-event collapse, `priceCombo`, `correlationModel`, `tetrachoric`, `wilson` |
| `scripts/combo-shadow.mjs` | CLI: `collect` (long-running), `fit`, `measure` |
| `scripts/combo-analysis.mjs` | the `fit` and `measure` bodies |
| `test/combo-pricer.test.mjs` | 8 unit tests (cdf, orthant, roles, product, copula sign, exclusive logic, tetrachoric recovery) |
| `fit.json` (here) | fitted same-game correlation classes |
| `measure.json` (here) | latest measurement report + 50 sample rows |

Machine state (append-only JSONL), `~/.local/state/561-group/settlements/forecasting-service/combos/`:
`rfqs.jsonl` (each RFQ once with legs/size/created, then status-change rows), `trades.jsonl` (combo tape),
`legs.jsonl` (leg book snapshots taken when an RFQ is discovered), `results.jsonl` (settled legs and combos),
`state.json`, `collector.log`.

Run: `node scripts/combo-shadow.mjs collect` (detached; ~125 MB RSS, ~1 GB/day disk at the default 1-in-10 sample),
`node scripts/combo-shadow.mjs fit --gap 350`, `node scripts/combo-shadow.mjs measure [--margin 0.01] [--since-hours H]`.

## What the public API gives a non-participant (observed)

* `GET /communications/rfqs` (signed) lists everyone's RFQs: combo ticker, `mve_selected_legs`, `created_ts`, status
  (`open`/`closed`), and size as `target_cost_dollars` (requester's spend) or `contracts_fp`. Open RFQs often show
  `target_cost 0`/`contracts` only. `GET /communications/quotes` is 403 (participants only): **quotes are invisible**.
* `GET /markets/trades` (public) is the whole exchange tape, ~200 trades/s of which ~1/4 are combos. A combo print
  carries `yes_price`, `count_fp`, `taker_outcome_side` (the requester), so the executed RFQ price is observable
  but the losing quotes are not. Hence "would our quote have won" can only be answered on executed RFQs.
* Real rates (not the ~100/30 s in the brief): up to ~200 RFQs in one second in bursts, ~19 RFQs/s and ~50+ combo
  prints/s sustained. The lane samples 1 in 10 combo tickers by FNV hash (RFQs and trades consistently), because the
  API throttles (429) at a few requests/s on the house IP and the leg snapshots, not statistics, are the bottleneck.
* Taker is YES in 89% of prints; median taker price 0.08. Median parlay has 6 legs.

## Pricer

fair = P(all legs win), leg win-probability p = mid of the leg's top-of-book (spread <= 0.12, else last), flipped for `no` legs.
* Distinct games: product.
* Legs inside one exclusive event (both teams of a GAME): exact set logic (two yes legs = 0; all-no = 1 - sum p).
* Same game, different markets: Gaussian copula, latent correlation by class `sport|roleA|roleB|same-team`
  (roles W winner, T total, S spread, TT team total, B BTTS, P player/other prop; same-team inferred from the game-id
  team codes), shrunk by n/(n+100), `no` legs flip the sign. Orthant probability by Genz SOV (2000-4000 pts, seeded).
* Coherence: the winner legs' mids are renormalised to sum to 1 over the event's outcome set (the engine's
  exclusive-set block constraint) and `assessFamily` is run on that family for a verdict. **This is much thinner than
  the full engine**: no ladder/monotone projection of totals/props, no LP-projected q (the engine returns margin and
  Dutch book, not a point). Treat leg p as raw mids.
* Our quote = fair +/- margin (default 0.01 in price; fees not modelled).

### Correlation fit (`fit.json`, 1,916 settled games, 107 classes, 10 pages/series cap)
Pooled tetrachoric ML (grid step 0.05) of yes-outcomes of settled same-game market pairs. Pooled across
games, strikes and players, so marginals are heterogeneous and correlations are biased (upward for ladders-with-
strikes, e.g. spread x winner hits the 0.95 clamp: nearly deterministic for same team, which is *right* for near-pick'em
strikes and wrong for -20 spreads). Headline classes (all sports): spread x winner same team +0.95, team total x winner
same team +0.55 (opp -0.55), total x total (other period/market) +0.25, total x team total +0.35, prop x winner same team
+0.10 (opp -0.15), prop x prop same team +0.10, prop x total ~0, total x winner ~0.
The honest weakness: this is not conditional on the pre-game price. A proper fit regresses on the leg's pre-game price
(candlesticks) and fits the copula to PIT-transformed residuals.

## Measurements so far (04:58Z, collector ~40 min old; 27,759 sampled RFQs, 5,640 executed prints matched to an RFQ)

* RFQ size (requester cost): p10 $2, p25 $10, median $10, p75 $22, p90 $102, p99 $1,000.
* The capital problem is the maker's collateral, not the requester's cost: a longshot parlay at 0.08 means the maker
  posts 1-y per contract. Executed prints: maker collateral median $84, p90 $1,096. At $25 we can fund 29% of
  executed prints, at $100 53%, at $300 74%. Full-size quoting is mandatory so a partial quote is not an option.
* 72% of RFQs are independent-leg (distinct games), 27% have a same-game cluster; 20% of executed prints are ones our
  fair+1c would have undercut (`wouldWin`); this fraction barely moves with the correlation scale (0..2x: 20.5% to
  19.2%) because most parlays are independent legs.
* Model EV to the maker on prints we'd win: +3.8c/contract, +5.2% of collateral at every correlation scale (+5.15% at
  0x, +5.17% at 1x, +5.43% at 2x). Across ALL executed prints the model EV is only +0.4% of collateral, i.e. the
  market's makers price essentially at our fair; the 5% on "would win" prints is selection (we only count prints where
  the taker overpaid relative to our fair), and selection on a model error is the winner's curse.
* Realised (settled outcomes), clustered by combo ticker, 95% CI (delta method):
  all prints n=91 (39 combos): +0.3% of collateral, CI [-8.8%, +9.5%];
  "would win" prints n=55 (24 combos): **-4.3%, CI [-32.9%, +24.4%]**. Those settled so far are short-dated
  (NCAAF/soccer/crypto 15m/NHL) and the sample is far too small to say anything: **no evidence of positive maker EV yet,
  and the first point estimate on our selected prints is negative.**
* Calibration: 399 settled sampled RFQs: mean fair 0.282 vs outcome 0.323, Brier 0.1030 (fitted and independent
  identical to 4 digits so far: the same-game cluster is too rare in the settled slice to separate them).

## Sensitivity to the correlation model (c)
Almost none on this book, because 72% of parlays are cross-game. Correlated parlays are 19% of executed prints
(1,062/5,640). The sensitivity worth worrying about is the one we do not model: leg-quote staleness (snapshot is taken
at RFQ discovery, up to ~90 s after creation, and the print may come later) and thin/wide leg books. Both produce spurious
"our fair is below the print" wins; the negative realised sign above is consistent with that.

## How long to run, and the verdict so far
* Crypto 15m and soccer settle within hours; NFL (Sunday 17:00Z-03:30Z), MLB and tennis within about a day.
  A CI of about +-5% of collateral needs on the order of 1,000+ settled "would-win" combo clusters;
  at the current accrual (~5,600 matched prints/40 min, ~20% would-win, most settling within 24 h) that is about
  **48 hours of collection** (2 full weekend sport slates), and 1-2 weeks to cover sport-by-sport and correlation classes.
  The collector is still running (restart-safe: state.json + deduped IDs); rerun `measure` any time.
* Verdict as of now: **we cannot yet claim an edge.** What the data does say: (1) executed combo prints sit within
  ~0.4% of collateral of our fair, so the venue's makers are not leaving 5% on the table on average; (2) the market is
  dominated by 6-leg independent parlays, where a coherent-mid product is the whole model, so any edge lives in leg-
  mid quality (liquid vs wide books, stale marks) rather than the copula; (3) capital: the maker must fund the full
  size at (1-price) per contract, median $84, p90 $1.1k.
* What capital makes it a real lane: ~$1,000-1,500 funds the median-to-p75 print and ~85-90% of prints, with
  per-quote concentration limits (joint Kelly via position-sizing-service across the simultaneously open quotes since
  maker fills are correlated through the shared leg events and each print is a full-size, all-or-nothing
  commitment). At $25-300 we are restricted to the 29-74% of prints at the small end, which are mostly the
  low-priced longshots whose price is dominated by tail marks (where mid error matters most). Do not size up until
  the CI above excludes zero on at least a few hundred settled combos, with fees (unknown maker fee schedule) added.

## Known gaps / next slices
1. Leg quote at print time (snapshot nearest the trade, not the RFQ) to remove the staleness bias.
2. Full engine coherence for ladders (totals, player thresholds) and per-leg wide-book rejection.
3. Pre-game-price-conditional copula fit (candlesticks) instead of pooled outcomes.
4. Fee and maker-rebate schedule for combos; liquidity of the offsetting side if we later hedge legs.
5. The collector samples 1/10; raise `--sample 1` only if the venue throttle allows (it did 429 at ~5 req/s).

## The Sports Prop Combo component incentive (CLIFF), measured 2026-10-04 ~15:45Z

Program (help.kalshi.com 17184676; filed 2026-09-02, runs to 2027-01-01): 25% of each combo's fees, scaled by its
share of eligible legs (sports props only: no winners, spreads, totals), goes to makers in those legs. Score is
`prod(1+F_i) - 1` over the maker's shares F_i of *maker volume* (fills, not resting size) in each leg outcome; payout
is proportional to score above 0.01, paid monthly as credits. On live events only maker volume after the scheduled
start counts, so the incentive is an in-play prop market-making subsidy. Combo fees: the series is
`quadratic_with_combo_maker_fees` (taker 0.07CP(1-P), maker half that; uncorrelated NFL parlays have no maker fee),
so the combo-maker P&L above is **before** a maker fee of 0.035CP(1-P) that it must now carry.

Code: `src/combo-incentive.mjs` (pure rules, the denominator interval `n <= sum S <= 2^n - 1`, payouts),
`scripts/combo-cliff.mjs` (`combo-shadow.mjs cliff` and `combo-shadow.mjs makers`). Outputs `cliff.json`, `makers.json`.

* Exchange scale (11.3 h window into an NFL Sunday, x10 sample): combo notional ~$51.5M/day, fees ~$3.2M/day
  (maker ~$0.8M), pool ~$211k/day = 6.5% of combo fees (most combos mix in ineligible game lines). NFL is 92% of the pool.
  40% of RFQs carry a prop, 21% are all-prop.
* Rebate per maker contract (pool/D over leg volume): on the 27 legs with >50k volume, about 0.4c (parity bound);
  over the top-200 legs 1.2c; the median leg 0.7-3c by denominator, and thin legs with real combo flow 10-90c.
  These are lower bounds on pool (pre-window combos missed) and on rebate (lifetime volume over-counts eligible volume).
* What makers actually earned on 229 settled, combo-popular prop legs (67 games, 12.7M contracts), vs the result:
  contract-weighted -11.3c [-16.9, -5.7]; per-leg equal-weighted -2.7c (se 1.4). **Split at scheduled start:**
  pre-start makers -9.4c per leg (se 2.7); **in-play makers -0.5c per leg (se 1.2), median -0.8c**.
  One night's slate dominated by a few big legs (three UFC KO/TKO yeses, NYY-TB run-in-first, a Judkins TD), so the
  pre-start number is mostly "the public's side hit"; it is not yet structural.
* Reading: in-play prop makers roughly break even on adverse selection before rebate, and the rebate pays only
  in-play volume. So the lane is *in-play prop making that does not get picked off*, and its economics are
  decided by quote-pull latency after a scoring generator is admitted, not by the joint model. That is the
  generator-admission / proof-lead experiment of issue #246, and it must be run before any capital.

Next slices: (1) WebSocket leg-book + trade recorder and a free live-stats feed recorder on the same clock, giving
per-generator lag (feed sees it vs Kalshi reprices); (2) in-play mark-outs at 1/5/30 s per maker fill by leg class;
(3) rerun `makers` over at least 3 full slates with games selected by start time, not by settlement.
