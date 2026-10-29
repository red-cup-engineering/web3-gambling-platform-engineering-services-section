---
name: forecasting-weather-markets
description: "Record the house forecast on each configured Kalshi weather market daily and score settled ones once."
closure-kind: process
requires-capabilities:
  - kalshi-weather-forecast
  - kalshi-weather-score
  - kalshi-market-read
---

# Forecasting weather markets

Run `kalshi-weather-forecast` daily before the markets move and `kalshi-weather-score` after they settle; each forecast is scored once.
