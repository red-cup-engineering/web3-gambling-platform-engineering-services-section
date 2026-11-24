---
name: executing-admitted-venue-orders
description: Turns one admitted order request into one bounded venue order under live credentials and policy, returning the venue's own receipt or refusal. Use when asked to turn one admitted order request into one bounded venue order under live credentials and policy.
---

# Executing admitted venue orders

The order executor of a prediction-market venue (Kalshi, Polymarket) receives one admitted desk order request, places exactly that bounded order under the venue's live credentials and policy, and returns the venue's own receipt or refusal. It refuses every order while activation is refused; it never decides that trading happens or attests the outcome.

1. Read the admitted work item and its bounds.
2. Place the order through the venue's execution service.
3. Discharge the work with the venue's receipt or refusal as evidence.
4. Propose the fill to the ledger; the venue's disagreement with a witness stays a refusal.
