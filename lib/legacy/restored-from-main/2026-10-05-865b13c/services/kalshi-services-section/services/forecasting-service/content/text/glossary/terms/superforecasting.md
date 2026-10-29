---
name: "Superforecasting"
date-created: 2026-09-05
aliases:
  - "superforecaster"
  - "calibrated forecasting"
description: "Philip Tetlock's finding that a small population of forecasters using disciplined, calibrated, continuously updated probabilistic reasoning systematically outperforms both typical expert pundits and, in tournament conditions, professional intelligence analysts."
references: {}
---

**Superforecasting** names the method and the population of forecasters identified by [Philip Tetlock](../../../../../../../../../../../../../../../../../../../../science-services-section/content/text/documents/articles/biographies/philip-tetlock.md)'s Good Judgment Project: a small subset of forecasters who, using disciplined probabilistic reasoning — decomposing questions into checkable components, updating frequently on new evidence, and actively seeking disconfirming information — systematically outperform typical expert pundits and, in IARPA-run tournament conditions, professional intelligence analysts with access to classified information.

Superforecasting is measured, not asserted: a forecaster's accuracy is scored against a proper scoring rule, most commonly the **Brier score** (the mean squared difference between a stated probability and the outcome, coded 0 or 1, over many forecasts — lower is better), which rewards genuine calibration (do stated probabilities match observed frequencies across many forecasts?) rather than confident narrative alone. Tetlock's earlier research found that "foxes" — forecasters who integrate many perspectives and hold views tentatively — substantially outperform "hedgehogs" — forecasters committed to one totalizing framework applied with high confidence — with confidence and public visibility, if anything, inversely correlated with accuracy.

The house's own forecasting pipeline (`forecasting-services-section`) implements this discipline directly: it records a probability and confidence estimate for every question and scores it with the Brier score, and the log score where defined, once the question resolves, rather than treating a plausible narrative as sufficient on its own. See [signal and noise](./signal-and-noise.md) for the complementary Bayesian-updating framing of the same discipline.
