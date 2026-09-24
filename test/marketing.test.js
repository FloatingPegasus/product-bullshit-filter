import assert from "node:assert/strict";
import test from "node:test";
import { classifyFragment, extractMeasurements } from "../extension/lib/marketing.js";

test("military-grade copy is marketing and a driver size is a spec", () => {
  const slogan = classifyFragment("Revolutionary military-grade earbuds with unparalleled premium sound");
  assert.equal(slogan.kind, "marketing");
  assert.ok(slogan.reasons.some((reason) => reason.code === "unverifiable_grade"));

  const spec = classifyFragment("Bluetooth 5.3 with 11 mm drivers");
  assert.equal(spec.kind, "spec");
  assert.ok(spec.measurements.some((item) => /Bluetooth 5\.3/i.test(item.value)));
  assert.ok(spec.measurements.some((item) => item.name === "Driver size"));
});

test("up to is a ceiling, and the earbud hours stay separate from the case", () => {
  const mixed = classifyFragment("Up to 80 hours of battery life for endless music");
  assert.equal(mixed.kind, "mixed");
  assert.ok(mixed.reasons.some((reason) => reason.code === "up_to"));

  const split = extractMeasurements("Battery: Up to 8 hours (earbuds) / up to 80 hours (with case)");
  const labels = split.map((item) => item.value);
  assert.ok(labels.some((value) => /8 hours \(earbuds\)/.test(value)));
  assert.ok(labels.some((value) => /80 hours \(with case\)/.test(value)));
});

test("a patent number is not treated as a vague patent claim", () => {
  const specific = classifyFragment("Patented hinge, US patent 11223344");
  assert.ok(!specific.reasons.some((reason) => reason.code === "patent_vague"));
});
