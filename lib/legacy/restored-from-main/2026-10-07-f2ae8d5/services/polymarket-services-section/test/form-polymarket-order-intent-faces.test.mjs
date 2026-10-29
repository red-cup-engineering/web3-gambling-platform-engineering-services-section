import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formPolymarketOrderIntent } from "../scripts/form-polymarket-order-intent.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "refuses no-calibration-record deterministically",
    "input": {
      "forecast": {
        "questionId": "xi-jinping-out-before-2027",
        "probability": 0.15
      },
      "calibrationRecord": null,
      "marketRead": {
        "tokenId": "32338220190071351435772801779725302244575775216413325951443816017994629993401",
        "bestBid": 0.047,
        "bestAsk": 0.048
      },
      "sleeve": {
        "remainingUsd": 100
      },
      "formedAt": "2026-09-05T12:00:00.000Z"
    },
    "output": {
      "type": "Reject",
      "code": "no-calibration-record",
      "detail": "no calibration record supplied for this reference class",
      "venueWrite": false
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await formPolymarketOrderIntent(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/form-polymarket-order-intent.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
