import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import { buildReport } from "../extension/lib/report.js";

const require = createRequire(import.meta.url);
const { scrapeDocument } = require("../extension/content/scrape-page.cjs");

function load(file, url) {
  const html = readFileSync(new URL(file, import.meta.url), "utf8");
  const window = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html);
  return scrapeDocument(window.document, new URL(url));
}

test("amazon markup becomes a walk-away report", () => {
  const scrape = load("./fixtures/amazon-page.html", "https://www.amazon.in/dp/B0NOVA80");
  assert.equal(scrape.marketplace, "Amazon");
  assert.equal(scrape.title, "Nova Buds X9 Wireless Earbuds");
  assert.equal(scrape.brand, "Nova");
  assert.equal(scrape.price.raw, "₹1,999");
  assert.equal(scrape.price.compareAtRaw, "₹7,999");
  assert.equal(scrape.seller.name, "NovaGadget Hub");
  assert.match(scrape.warranty, /6 months/);
  assert.match(scrape.returns, /not eligible for refund/);
  assert.equal(scrape.rating.count, 12431);
  assert.ok(scrape.bullets.some((bullet) => /military-grade/i.test(bullet)));
  assert.ok(scrape.specs.some((spec) => spec.name === "Driver" && /11 mm/.test(spec.value)));
  assert.equal(scrape.reviews.length, 5);
  assert.ok(scrape.histogram.some((row) => row.stars === 5 && row.percent === 78));

  const report = buildReport(scrape, { now: new Date("2026-09-25T00:00:00Z") });
  assert.ok(report.verdict.score >= 70, `score ${report.verdict.score}`);
  assert.ok(report.gotchas.some((item) => item.code === "battery"));
  assert.ok(report.reviews.flags.some((flag) => flag.code === "duplicate"));
});

test("current amazon review, histogram, and seller hooks", () => {
  const html = `<!doctype html><body>
    <span id="productTitle">OnePlus Nord Buds</span>
    <a id="bylineInfo">Visit the OnePlus Store</a>
    <ul id="histogramTable">
      <li><a aria-label="63 percent of reviews have 5 stars"></a></li>
      <li><a aria-label="7 percent of reviews have 1 stars"></a></li>
    </ul>
    <div id="desktop_buybox">Ships from Amazon Sold by FUTUERASTIC LIFESTYLE Gift options</div>
    <a id="sellerProfileTriggerId">FUTUERASTIC LIFESTYLE</a>
    <table class="a-keyvalue prodDetTable">
      <tr><th>Warranty Description</th><td>1 year</td></tr>
      <tr><th>Driver Size</th><td>12.4 mm</td></tr>
      <tr><th>Customer Reviews</th><td>4.3 out of 5 stars var dpAcrHasRegisteredArcLinkClickAction; P.when('A')</td></tr>
    </table>
    <table class="inemi-plans-table">
      <tr><th>EMI Plan</th><td>3 months</td></tr>
      <tr><th>Interest</th><td>15%</td></tr>
    </table>
    <div data-hook="review">
      <span data-hook="genome-widget">simonbritto</span>
      <span data-hook="review-star-rating">5 out of 5 stars</span>
      <span data-hook="reviewTitle">Hello guys</span>
      <span data-hook="review-date">Reviewed in India on 28 July 2026</span>
      <span data-hook="avp-badge">Verified Purchase</span>
      <div data-hook="reviewText">Battery lasted the work week. The 12.4 mm driver is the reason I bought it. Read more</div>
    </div>
  </body></html>`;
  const window = new Window({
    url: "https://www.amazon.in/dp/B0TEST",
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  window.document.write(html);
  const scrape = scrapeDocument(window.document, new URL("https://www.amazon.in/dp/B0TEST"));
  assert.equal(scrape.seller.name, "FUTUERASTIC LIFESTYLE");
  assert.equal(scrape.seller.fulfilledBy, "Amazon");
  assert.ok(scrape.histogram.some((row) => row.stars === 5 && row.percent === 63));
  assert.equal(scrape.reviews[0].title, "Hello guys");
  assert.equal(scrape.reviews[0].author, "simonbritto");
  assert.match(scrape.reviews[0].body, /12\.4 mm driver/);
  assert.doesNotMatch(scrape.reviews[0].body, /read more/i);
  assert.ok(scrape.specs.some((spec) => /12\.4 mm/.test(spec.value)));
  assert.equal(scrape.warranty, "1 year");
  assert.ok(!scrape.specs.some((spec) => /emi/i.test(spec.name)));
  assert.ok(!scrape.specs.some((spec) => /customer reviews/i.test(spec.name)));
});

test("a generic listing page is enough when the marketplace is unfamiliar", () => {
  const scrape = load("../demo/listing.html", "https://north.market/p/nova-buds-x9");
  assert.equal(scrape.marketplace, "North");
  assert.match(scrape.title, /Nova Buds X9/);
  assert.equal(scrape.price.raw, "₹1,999");
  assert.match(scrape.seller.name, /NovaGadget Hub/);
  assert.match(scrape.warranty, /6 months/);
  assert.match(scrape.returns, /7-day/);
  assert.ok(scrape.bullets.length >= 6);
  assert.ok(scrape.specs.some((spec) => /IP55/.test(spec.value)));
  assert.ok(scrape.histogram.some((row) => row.stars === 1 && row.percent === 11));
  assert.ok(scrape.reviews.length >= 3);
});
