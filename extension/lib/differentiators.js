/** Pick comparable facts. A differentiator has a number, a standard, or a named material — and is not a slogan. */

import { categoryExpectations } from "./category.js";
import { extractMeasurements, isMushySpec } from "./marketing.js";
import { lower, norm, uniqueBy } from "./text.js";

const EXCLUDE = /warranty|return|refund|seller|sold by|brand|color|colour|quantity|pack of|star rating|customer review|best seller|date first/i;

export function pickDifferentiators(scrape, category) {
  const candidates = [];
  for (const spec of scrape.specs || []) {
    if (!spec?.name || !spec?.value) continue;
    if (EXCLUDE.test(spec.name)) continue;
    if (isMushySpec(spec.name, spec.value)) continue;
    const measurements = extractMeasurements(`${spec.name}: ${spec.value}`);
    if (measurements.length) {
      for (const measurement of measurements) {
        candidates.push(toCandidate(measurement, spec.source || "spec table", `${spec.name}: ${spec.value}`));
      }
    } else {
      candidates.push({
        name: norm(spec.name),
        value: norm(spec.value),
        source: spec.source || "spec table",
        evidence: `${norm(spec.name)}: ${norm(spec.value)}`,
        conditional: /\bup to\b/i.test(spec.value),
        score: scoreCandidate(spec.name, spec.value, spec.source || "spec table", false),
      });
    }
  }

  for (const bullet of scrape.bullets || []) {
    for (const measurement of extractMeasurements(bullet)) {
      candidates.push(toCandidate(measurement, "bullet", bullet));
    }
  }

  const ranked = uniqueBy(
    candidates
      .filter((item) => item.score > 0 && !EXCLUDE.test(item.name))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.value.localeCompare(b.value)),
    (item) => lower(`${item.name} ${item.value}`),
  );
  const named = ranked.filter((item) => item.name !== "Measured value");
  const chosen = (named.length >= 3 ? named : ranked).slice(0, 5);

  return chosen.map((item, index) => ({
    rank: index + 1,
    title: displayTitle(item),
    detail: detailLine(item),
    evidence: item.evidence,
    source: item.source,
    conditional: item.conditional,
  }));
}

export function expectationGaps(scrape, category, differentiators) {
  const blob = [
    scrape.title,
    ...(scrape.bullets || []),
    ...(scrape.specs || []).map((spec) => `${spec.name} ${spec.value}`),
    scrape.description,
    ...differentiators.map((item) => `${item.title} ${item.evidence}`),
  ].join("\n");
  return categoryExpectations(category)
    .filter((item) => !item.re.test(blob))
    .map((item) => item.label);
}

function toCandidate(measurement, source, evidence) {
  const conditional = measurement.conditional || /\bup to\b/i.test(evidence);
  return {
    name: measurement.name,
    value: measurement.value,
    source,
    evidence: norm(evidence),
    conditional,
    score: scoreCandidate(measurement.name, measurement.value, source, conditional),
  };
}

function scoreCandidate(name, value, source, conditional) {
  const blob = `${name} ${value}`;
  let score = 1;
  if (/spec table/i.test(source)) score += 3;
  if (/\b(IP\d{2}|Bluetooth\s*\d|USB-C|LDAC|aptX|mAh|nits|Wh)\b/i.test(blob)) score += 3;
  if (/driver size|latency/i.test(name) && /\d/.test(value)) score += 2;
  if (/^20\s*(?:hz|khz)$/i.test(value)) score -= 5;
  if (/\d/.test(value)) score += 2;
  if (conditional) score -= 2;
  if (/\b(premium|quality|design|universal|compatible|gift|perfect)\b/i.test(blob)) score -= 3;
  if (value.length > 120) score -= 2;
  return score;
}

function displayTitle(item) {
  const named = item.value.toLowerCase().startsWith(item.name.toLowerCase());
  if (named) {
    if (item.conditional && !/\bup to\b/i.test(item.value)) return `Up to ${item.value}`;
    return item.value;
  }
  if (item.conditional && !/\bup to\b/i.test(item.value)) return `${item.name}: up to ${item.value}`;
  return `${item.name}: ${item.value}`;
}

function detailLine(item) {
  const source = item.source === "spec table" ? "the spec table" : "a bullet";
  if (item.conditional) {
    return `Taken from ${source}. It is written as a ceiling, so compare it only with other "up to" figures, or ignore it until the listing states volume, codec, or load.`;
  }
  return `Taken from ${source}. This is something you can line up against another listing.`;
}
