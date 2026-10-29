import assert from "node:assert/strict";
import test from "node:test";
import { resolveCliDataRoot } from "../apps/forecast-weather-markets-cli.mjs";

test("resolveCliDataRoot returns undefined with no flag and no env var set", () => {
  assert.equal(resolveCliDataRoot([], {}), undefined);
});

test("resolveCliDataRoot reads FORECASTING_DAILY_CYCLE_DATA_ROOT from the given env when no --data-root flag is present", () => {
  const dataRoot = resolveCliDataRoot(["--config", "x.json"], { FORECASTING_DAILY_CYCLE_DATA_ROOT: "/state/forecasting" });
  assert.equal(dataRoot, "/state/forecasting");
});

test("resolveCliDataRoot prefers an explicit --data-root flag over the env var", () => {
  const dataRoot = resolveCliDataRoot(["--data-root", "/flag/root"], { FORECASTING_DAILY_CYCLE_DATA_ROOT: "/env/root" });
  assert.equal(dataRoot, "/flag/root");
});
