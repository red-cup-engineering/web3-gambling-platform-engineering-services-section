import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { placeKalshiOrder } from "../scripts/place-kalshi-order.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "refuses venue-not-activated when activation is refused",
    "input": {
      "intent": {
        "ticker": "KXHIGHNY-26SEP05-T79",
        "side": "yes",
        "action": "buy",
        "contracts": 3,
        "priceDollars": 0.27
      },
      "activation": {
        "orderExecution": "refused"
      }
    },
    "output": {
      "type": "Reject",
      "code": "venue-not-activated",
      "detail": "Kalshi order execution requires live activation with armed credentials; venue accounts remain the founder's hands",
      "venueWrite": false
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await placeKalshiOrder(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/place-kalshi-order.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
