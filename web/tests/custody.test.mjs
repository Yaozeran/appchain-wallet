import test from "node:test";
import assert from "node:assert/strict";
import { decimalUnits, formatUnits, purchasePreview, activityLabel } from "../src/lib/custody.ts";

test("demo conversions preserve cents and wei without floating point", () => {
  assert.equal(purchasePreview("100.00", "2500.00"), "0.04");
  assert.equal(purchasePreview("0.01", "2500.00"), "0.000004");
  assert.equal(decimalUnits("0.000000000000000001", 18), 1n);
  assert.equal(formatUnits("100001", 2), "1000.01");
  assert.equal(formatUnits("999999999999999999", 18), "0.999999999999999999");
});
test("invalid demo amounts cannot produce misleading quotes", () => {
  for (const value of ["-1", "1e3", "NaN", "0.001", "", "1.", "Infinity"]) {
    assert.equal(purchasePreview(value, "2500.00"), null);
  }
  assert.equal(purchasePreview("0", "2500.00"), null);
  assert.equal(purchasePreview("10", "0"), null);
});
test("external payments are visibly simulated", () => {
  assert.match(activityLabel("EXTERNAL_SIMULATED"), /simulated/);
});
