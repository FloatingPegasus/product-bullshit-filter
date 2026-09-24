/** Plain-text copy of a report, for the clipboard. */

import { norm } from "./text.js";

export function reportToPlainText(report) {
  const lines = [];
  const product = report.product || {};
  lines.push(product.title || "Product");
  lines.push([product.marketplace, product.price, product.url].filter(Boolean).join(" · "));
  lines.push("");
  lines.push(`${report.verdict.headline} · bullshit ${report.verdict.score}/100`);
  lines.push(report.verdict.summary);
  lines.push("");
  lines.push("Score");
  for (const row of report.verdict.breakdown || []) {
    lines.push(`- ${row.label}: ${row.points}/${row.max} — ${row.note}`);
  }
  lines.push("");
  lines.push("What actually differs");
  if (!(report.differentiators || []).length) {
    lines.push("- Nothing on the page is specific enough to compare.");
  }
  for (const item of report.differentiators || []) {
    lines.push(`${item.rank}. ${item.title}`);
    lines.push(`   ${item.detail}`);
  }
  lines.push("");
  lines.push("Specs");
  for (const spec of report.specs || []) lines.push(`- ${spec.name}: ${spec.value} (${spec.source})`);
  lines.push("");
  lines.push("Marketing");
  for (const item of report.marketing || []) lines.push(`- ${item.text} — ${item.reason}`);
  lines.push("");
  lines.push("Seller, warranty, returns");
  lines.push(
    [
      report.seller?.name && `Seller: ${report.seller.name}`,
      report.seller?.fulfilledBy && `Fulfilled by: ${report.seller.fulfilledBy}`,
      report.seller?.warranty && `Warranty: ${report.seller.warranty}`,
      report.seller?.returns && `Returns: ${report.seller.returns}`,
    ]
      .filter(Boolean)
      .join("\n") || "Not found on the page.",
  );
  for (const flag of report.seller?.flags || []) lines.push(`- ${flag.title}: ${flag.detail}`);
  lines.push("");
  lines.push("Review patterns");
  lines.push(report.reviews?.note || "");
  for (const flag of report.reviews?.flags || []) lines.push(`- ${flag.title}: ${flag.detail}`);
  lines.push("");
  lines.push("Gotchas");
  for (const item of report.gotchas || []) lines.push(`- [${item.severity}] ${item.title}: ${item.detail}`);
  lines.push("");
  lines.push("Betterment");
  for (const item of report.betterment || []) lines.push(`- ${item.title}: ${item.detail}`);
  lines.push("");
  lines.push("Ask before you pay");
  for (const question of report.questions || []) lines.push(`- ${question}`);
  lines.push("");
  lines.push("Limits");
  for (const limit of report.limits || []) lines.push(`- ${limit}`);
  return lines.map((line) => norm(line) === "" && line !== "" ? line : line).join("\n").trim();
}
