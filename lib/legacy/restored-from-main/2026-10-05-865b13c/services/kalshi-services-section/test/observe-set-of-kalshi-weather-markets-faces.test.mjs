import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { observeSetOfKalshiWeatherMarkets } from "../scripts/observe-set-of-kalshi-weather-markets.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "empty series list returns no observations",
    "input": {
      "seriesTickers": [],
      "observedAt": "2026-09-04T12:00:00.000Z"
    },
    "output": []
  },
  {
    "type": "JavascriptNodeOperationExample",
    "name": "empty series list with overrides still returns no observations",
    "input": {
      "seriesTickers": [],
      "observedAt": "2026-09-04T12:00:00.000Z",
      "baseUrl": "https://api.elections.kalshi.com/trade-api/v2",
      "status": "open",
      "maxPagesPerSeries": 2
    },
    "output": []
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await observeSetOfKalshiWeatherMarkets(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/observe-set-of-kalshi-weather-markets.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
