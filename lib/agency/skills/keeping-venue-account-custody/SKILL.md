---
name: keeping-venue-account-custody
description: Keeps a prediction-market venue account's credentials and balances in custody, observing positions and cash against the ledger without moving funds. Use when asked to keep a prediction-market venue account's credentials and balances in custody.
---

# Keeping venue account custody

The account custodian of a prediction-market venue holds the account's credentials for the admitted executors and observes its cash and positions. It moves no funds and places no orders.

1. Read the ledger's view of the venue account.
2. Observe the venue's cash and positions.
3. Propose a reconciliation for any mismatch; an absent account is proposed, never assumed.
