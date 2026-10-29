import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deriveCalibrationRecord } from "../scripts/derive-calibration-record.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "one reference class with both house and market resolved rows, gate not yet met",
    "input": {
      "scoredForecasts": [
        {
          "referenceClass": "kalshi.weather.KXHIGHNY",
          "questionId": "kxhighny-26sep04-t86",
          "kind": "house",
          "probability": 0.1,
          "outcome": 0,
          "brierScore": 0.01
        },
        {
          "referenceClass": "kalshi.weather.KXHIGHNY",
          "questionId": "kxhighny-26sep04-t86",
          "kind": "market",
          "probability": 0.3,
          "outcome": 0,
          "brierScore": 0.09
        }
      ],
      "derivedAt": "2026-09-05T00:00:00Z"
    },
    "output": [
      {
        "type": "CalibrationRecord",
        "version": 1,
        "referenceClass": "kalshi.weather.KXHIGHNY",
        "resolvedForecastCount": 1,
        "brierScore": 0.01,
        "marketImpliedBrierScore": 0.09,
        "edgeVsMarket": 0.08,
        "calibrationBins": [
          {
            "bucketIndex": 0,
            "rangeLow": 0,
            "rangeHigh": 0.1,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 1,
            "rangeLow": 0.1,
            "rangeHigh": 0.2,
            "count": 1,
            "meanStatedProbability": 0.1,
            "realizedFrequency": 0
          },
          {
            "bucketIndex": 2,
            "rangeLow": 0.2,
            "rangeHigh": 0.3,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 3,
            "rangeLow": 0.3,
            "rangeHigh": 0.4,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 4,
            "rangeLow": 0.4,
            "rangeHigh": 0.5,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 5,
            "rangeLow": 0.5,
            "rangeHigh": 0.6,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 6,
            "rangeLow": 0.6,
            "rangeHigh": 0.7,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 7,
            "rangeLow": 0.7,
            "rangeHigh": 0.8,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 8,
            "rangeLow": 0.8,
            "rangeHigh": 0.9,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          },
          {
            "bucketIndex": 9,
            "rangeLow": 0.9,
            "rangeHigh": 1,
            "count": 0,
            "meanStatedProbability": null,
            "realizedFrequency": null
          }
        ],
        "minResolvedForecasts": 30,
        "calibrationGateMet": false,
        "derivedAt": "2026-09-05T00:00:00Z"
      }
    ]
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await deriveCalibrationRecord(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/derive-calibration-record.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
