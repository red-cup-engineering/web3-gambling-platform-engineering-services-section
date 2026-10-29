import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formKalshiOrderIntent } from "../scripts/form-kalshi-order-intent.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "refuses no-calibration-record deterministically",
    "input": {
      "forecast": {
        "questionId": "kxhighny-26sep05-t79",
        "probability": 0.6
      },
      "calibrationRecord": null,
      "marketRead": {
        "ticker": "KXHIGHNY-26SEP05-T79",
        "yesBid": 0.26,
        "yesAsk": 0.27,
        "noBid": 0.73,
        "noAsk": 0.74
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
    const importedOutput = await formKalshiOrderIntent(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/form-kalshi-order-intent.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
