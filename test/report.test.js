import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReport } from "../extension/lib/report.js";
import { parseLooseDate } from "../extension/lib/text.js";

const shady = JSON.parse(readFileSync(new URL("../extension/fixtures/earbuds.json", import.meta.url), "utf8"));
const clean = JSON.parse(readFileSync(new URL("../extension/fixtures/power-bank.json", import.meta.url), "utf8"));

test("shady earbuds score as unverifiable and name the real tricks", () => {
  const report = buildReport(shady, { now: new Date("2026-09-25T00:00:00Z") });
  assert.ok(report.verdict.score >= 70, `score ${report.verdict.score}`);
  assert.equal(report.verdict.band, "walkaway");
  assert.match(report.verdict.summary, /military-grade|measurement/i);
  const diff = report.differentiators.map((item) => item.title).join(" | ");
  assert.match(diff, /IP55/);
  assert.match(diff, /Bluetooth/i);
  assert.doesNotMatch(diff, /revolutionary|military-grade|ultimate gift/i);
  assert.ok(report.differentiators.length <= 5);
  assert.ok(report.gotchas.some((item) => item.code === "battery"));
  assert.ok(report.reviews.flags.some((flag) => flag.code === "polarization"));
  assert.ok(report.reviews.flags.some((flag) => flag.code === "duplicate"));
  assert.ok(report.seller.flags.some((flag) => flag.code === "no_refund" || flag.code === "third_party"));
  assert.ok(report.marketing.some((item) => /military-grade/i.test(item.text)));
  assert.equal(report.verdict.breakdown.reduce((sum, row) => sum + row.max, 0), 100);
});

test("plain power bank stays in the measurable band", () => {
  const report = buildReport(clean, { now: new Date("2026-09-25T00:00:00Z") });
  assert.ok(report.verdict.score < 30, `score ${report.verdict.score} ${report.verdict.summary}`);
  assert.equal(report.verdict.band, "substance");
  assert.equal(report.reviews.flags.length, 0);
  assert.equal(report.seller.flags.length, 0);
  assert.ok(report.differentiators.some((item) => /20000 mAh|65 W|74 Wh|480 g/i.test(item.title)));
  assert.ok(!report.gotchas.some((item) => item.severity === "high"));
});

test("a page with no product facts is not called measurable", () => {
  const report = buildReport({ url: "https://example.com", title: "Example Domain", bullets: [], specs: [], reviews: [] });
  assert.notEqual(report.verdict.band, "substance");
  assert.equal(report.verdict.headline, "This page is not a listing");
  assert.match(report.verdict.summary, /nothing on this page can be compared/);
});

test("review dates in marketplace phrasing parse", () => {
  assert.equal(parseLooseDate("Reviewed in India on 2 March 2026")?.toISOString(), "2026-03-02T00:00:00.000Z");
  assert.equal(parseLooseDate("Reviewed in the United States on January 11, 2026")?.toISOString(), "2026-01-11T00:00:00.000Z");
  assert.equal(parseLooseDate("2026-03-02")?.toISOString(), "2026-03-02T00:00:00.000Z");
  assert.equal(parseLooseDate("not a date"), null);
});
