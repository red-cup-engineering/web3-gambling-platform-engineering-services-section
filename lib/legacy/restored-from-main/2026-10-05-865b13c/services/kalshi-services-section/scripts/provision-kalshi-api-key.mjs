#!/usr/bin/env node
// Puts the weather desk's Kalshi API key in this host's custody, with the
// person at the node in the assisted browser; prints a receipt with no secret.
// See src/provisioning.mjs.
import { provisionApiKey } from '../src/provisioning.mjs';

const receipt = await provisionApiKey();
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = receipt.stoppedEarly ? 1 : 0;
