import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveSetOfForecastQuestions } from "../scripts/resolve-set-of-forecast-questions.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "an indian-country.tribal-elections question always stays Open, no network call",
    "input": {
      "questions": [
        {
          "id": "oglala-sioux-tribe-general-election-2026",
          "sourcePlatform": "indian-country.tribal-elections"
        }
      ],
      "now": "2026-09-05T07:24:32Z"
    },
    "output": [
      {
        "type": "Open",
        "questionId": "oglala-sioux-tribe-general-election-2026",
        "reason": "tribal election certification is not machine-integrated; resolves manually against the tribe's own Election Board/Commission announcement or Indianz.com/Native News Online reporting"
      }
    ]
  },
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a goods-prices question with no configured seriesUrl stays Open, no network call",
    "input": {
      "questions": [
        {
          "id": "south-dakota-propane-price-above-2-2026-10",
          "sourcePlatform": "indian-country.goods-prices"
        }
      ],
      "now": "2026-09-05T07:24:32Z"
    },
    "output": [
      {
        "type": "Open",
        "questionId": "south-dakota-propane-price-above-2-2026-10",
        "reason": "no resolutionParameters.seriesUrl configured for indian-country.goods-prices (EIA and USDA AMS programmatic access both require a registered API key this operation does not hold); resolves manually against eia.gov/petroleum/heatingoilpropane or ams.usda.gov reports"
      }
    ]
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await resolveSetOfForecastQuestions(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/resolve-set-of-forecast-questions.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
