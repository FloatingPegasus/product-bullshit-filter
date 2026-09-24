/** Turn a scraped listing into a risk report. The score is always computed here, including after a model pass. */

import { detectCategory } from "./category.js";
import { expectationGaps, pickDifferentiators } from "./differentiators.js";
import { classifyFragment } from "./marketing.js";
import { analyzeReviews } from "./reviews.js";
import { analyzeSeller } from "./seller.js";
import { clamp, money, norm, sentences, uniqueBy } from "./text.js";

const HEADLINES = {
  substance: "Mostly measurable",
  mixed: "Specs mixed with copy",
  marketing: "Marketing is doing the selling",
  walkaway: "Too much of this listing is unverifiable",
};

export function buildReport(scrape, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const source = scrape || {};
  const category = detectCategory(source);
  const fragments = collectFragments(source);
  const classified = fragments.map((fragment) => ({ ...fragment, ...classifyFragment(fragment.text) }));
  const specs = collectSpecs(source, classified);
  const marketing = collectMarketing(classified);
  const differentiators = pickDifferentiators(source, category);
  const reviews = analyzeReviews(source);
  const seller = analyzeSeller(source, category);
  const battery = batteryInflation(source);
  const conflicts = findConflicts(source);
  const gaps = expectationGaps(source, category, differentiators);
  const extras = extraSignals(source);
  extras.foreign = Boolean(foreignProduct(source));
  extras.bluetoothConflict = Boolean(bluetoothVersions(source));
  const breakdown = scoreBreakdown({ classified, reviews, seller, battery, conflicts, gaps, specs, extras });
  const score = clamp(Math.round(breakdown.reduce((sum, row) => sum + row.points, 0)), 0, 100);
  const thin = classified.length === 0 && specs.length === 0;
  const band = thin && score < 50 ? "mixed" : bandFor(score);
  const gotchas = collectGotchas({ marketing, seller, reviews, battery, conflicts, extras, category, source });
  const betterment = collectBetterment({ gaps, gotchas, seller, battery, category });
  const questions = collectQuestions({ seller, battery, gaps, reviews, category });

  return {
    version: 1,
    analyzedAt: now.toISOString(),
    engine: "local",
    category,
    product: {
      title: norm(source.title) || "Untitled listing",
      brand: norm(source.brand),
      price: norm(source.price?.raw),
      compareAt: norm(source.price?.compareAtRaw),
      url: norm(source.url),
      marketplace: norm(source.marketplace) || "This page",
      ratingAverage: reviews.average,
      ratingCount: reviews.count,
      availability: norm(source.availability),
      variant: norm(source.variant),
    },
    verdict: {
      score,
      band,
      headline: thin ? "This page is not a listing" : HEADLINES[band],
      summary: summarize({ classified, marketing, seller, reviews, battery, score, band, specs }),
      breakdown,
    },
    differentiators,
    specs,
    marketing,
    seller,
    reviews,
    gotchas,
    betterment,
    questions,
    limits: limitsFor(source),
  };
}

function collectFragments(scrape) {
  const fragments = [];
  for (const bullet of scrape.bullets || []) {
    const text = norm(bullet);
    if (text.length > 8) fragments.push({ text, source: "bullet" });
  }
  for (const sentence of sentences(scrape.description).slice(0, 8)) {
    fragments.push({ text: sentence, source: "description" });
  }
  return fragments;
}

function collectSpecs(scrape, classified) {
  const rows = [];
  for (const spec of scrape.specs || []) {
    const name = norm(spec.name);
    const value = norm(spec.value);
    if (!name || !value) continue;
    if (/^warranty\b|^returns?\b|^refund\b/i.test(name)) continue;
    const classifiedRow = classifyFragment(`${name}: ${value}`);
    if (classifiedRow.kind === "marketing") continue;
    rows.push({ name, value, source: spec.source || "spec table" });
  }
  for (const fragment of classified) {
    if (fragment.kind !== "spec") continue;
    for (const measurement of fragment.measurements) {
      const value = measurement.conditional ? `up to ${measurement.value}` : measurement.value;
      const covered = rows.some((row) => {
        const blob = `${row.name} ${row.value}`.toLowerCase();
        return blob.includes(measurement.value.toLowerCase()) || blob.includes(String(measurement.raw).toLowerCase());
      });
      if (covered) continue;
      rows.push({ name: measurement.name, value, source: fragment.source });
    }
  }
  return uniqueBy(rows, (row) => `${row.name.toLowerCase()}::${row.value.toLowerCase()}`).slice(0, 40);
}

function collectMarketing(classified) {
  return classified
    .filter((fragment) => fragment.kind === "marketing" || fragment.kind === "mixed")
    .filter((fragment) => fragment.reasons.some((reason) => reason.code !== "unsupported" || fragment.kind === "marketing"))
    .map((fragment) => {
      const ranked = [...fragment.reasons].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
      return {
        text: fragment.text,
        reason: ranked.map((reason) => reason.label).join(" · "),
        severity: ranked[0]?.severity || "low",
        codes: ranked.map((reason) => reason.code),
        source: fragment.source,
      };
    });
}

function scoreBreakdown({ classified, reviews, seller, battery, conflicts, gaps, specs, extras }) {
  let ad = 0;
  if (classified.length) {
    const weight = classified.reduce((sum, fragment) => {
      if (fragment.kind === "marketing") return sum + 1;
      if (fragment.kind === "mixed") return sum + 0.55;
      return sum;
    }, 0);
    ad = (weight / classified.length) * 40;
  } else if (!specs.length) {
    ad = 18;
  }

  let slippery = 0;
  if (!specs.length) slippery += 8;
  if (battery) slippery += 8;
  if (conflicts.length) slippery += 6;
  if (extras.steepDiscount) slippery += 3;
  if (extras.subscription) slippery += 4;
  if (extras.foreign) slippery += 8;
  if (extras.bluetoothConflict) slippery += 6;
  slippery += Math.min(6, gaps.length * 2);

  return [
    {
      id: "copy",
      label: "Ad copy vs measurements",
      points: round1(ad),
      max: 40,
      note: classified.length
        ? `${classified.filter((fragment) => fragment.kind === "marketing").length} of ${classified.length} lines have no measurement.`
        : "No bullets or description were found.",
    },
    {
      id: "reviews",
      label: "Review patterns",
      points: round1(reviews.risk * 25),
      max: 25,
      note: reviews.flags[0]?.title || "No suspicious pattern in what this page shows.",
    },
    {
      id: "seller",
      label: "Seller, warranty, returns",
      points: round1(seller.risk * 20),
      max: 20,
      note: seller.flags[0]?.title || "Seller terms are present and ordinary.",
    },
    {
      id: "slippery",
      label: "Missing or slippery facts",
      points: round1(Math.min(15, slippery)),
      max: 15,
      note: slipperyNote(battery, conflicts, gaps, specs),
    },
  ];
}

function slipperyNote(battery, conflicts, gaps, specs) {
  if (battery) return battery.title;
  if (conflicts.length) return conflicts[0].title;
  if (!specs.length) return "No spec table or measured bullet was found.";
  if (gaps.length) return `Still unnamed: ${gaps.slice(0, 2).join(", ")}.`;
  return "The comparable facts are actually on the page.";
}

function bandFor(score) {
  if (score < 30) return "substance";
  if (score < 50) return "mixed";
  if (score < 72) return "marketing";
  return "walkaway";
}

function summarize({ classified, marketing, seller, reviews, battery, score, band, specs }) {
  if (!classified.length && (!specs || specs.length === 0)) {
    return "Almost nothing on this page can be compared. It is a name, a price, and whatever the template added.";
  }
  const bits = [];
  const adLines = classified.filter((fragment) => fragment.kind === "marketing");
  if (adLines.length) {
    const labels = uniqueLabels(marketing).slice(0, 3);
    bits.push(
      `${adLines.length} of ${classified.length} lines are claims without a measurement${labels.length ? ` (${labels.join(", ")})` : ""}.`,
    );
  } else if (band === "substance") {
    bits.push("The lines that describe the product carry measurements instead of slogans.");
  }
  if (battery) bits.push(battery.detail);
  const sellerFlag = seller.flags.find((flag) => flag.severity === "high") || seller.flags.find((flag) => flag.severity === "medium");
  if (sellerFlag) bits.push(sellerFlag.detail);
  const reviewFlag = reviews.flags[0];
  if (reviewFlag) bits.push(reviewFlag.detail);
  if (!bits.length) bits.push("Nothing in the visible listing tripped the seller, review, or slogan checks.");
  return bits.slice(0, 4).join(" ");
}

function uniqueLabels(marketing) {
  const labels = [];
  for (const item of marketing) {
    for (const code of item.codes || []) {
      if (code === "unsupported" || code === "vague_quality" || code === "perfect") continue;
      const reason = item.reason.split(" · ")[0];
      if (!labels.includes(reason)) labels.push(reason);
    }
  }
  return labels;
}

function collectGotchas({ marketing, seller, reviews, battery, conflicts, extras, category, source }) {
  const gotchas = [];
  const groups = new Map();
  for (const item of marketing) {
    const labels = String(item.reason || "").split(" · ");
    (item.codes || []).forEach((code, index) => {
      if (code === "unsupported" || code === "vague_quality" || code === "perfect" || code === "model") return;
      const label = labels[index] || labels[0] || code;
      const bucket = groups.get(code) || { code, count: 0, label, sample: item.text };
      bucket.count += 1;
      groups.set(code, bucket);
    });
  }
  for (const bucket of groups.values()) {
    gotchas.push({
      code: bucket.code,
      severity: bucket.code === "unverifiable_grade" || bucket.code === "authority" || bucket.code === "guaranteed" ? "high" : "medium",
      title: bucket.count > 1 ? `${bucket.label} (${bucket.count} lines)` : bucket.label,
      detail: truncate(bucket.sample),
    });
  }
  if (battery) gotchas.push(battery);
  for (const conflict of conflicts) gotchas.push(conflict);
  for (const flag of seller.flags) {
    if (flag.severity === "low" && flag.code !== "intl") continue;
    gotchas.push({ code: flag.code, severity: flag.severity, title: flag.title, detail: flag.detail });
  }
  for (const flag of reviews.flags) {
    gotchas.push({
      code: flag.code,
      severity: flag.severity,
      title: flag.title,
      detail: flag.evidence ? `${flag.detail} “${flag.evidence}”` : flag.detail,
    });
  }
  if (extras.steepDiscount) {
    gotchas.push({
      code: "anchor",
      severity: "low",
      title: "The discount is an anchor",
      detail: `${extras.compareAt} against ${extras.price} is more than half off. Compare the absolute price, not the percent.`,
    });
  }
  if (extras.subscription) {
    gotchas.push({
      code: "subscription",
      severity: "medium",
      title: "A subscription is attached to this listing",
      detail: "Check that the price you are looking at is the one-time price, not a subscribe-and-save condition.",
    });
  }
  if (extras.urgency) {
    gotchas.push({
      code: "urgency",
      severity: "low",
      title: "The page is counting down stock",
      detail: extras.urgency,
    });
  }
  if (category === "supplement" && /proprietary blend/i.test(`${source.description} ${(source.bullets || []).join(" ")}`)) {
    gotchas.push({
      code: "blend",
      severity: "high",
      title: "Proprietary blend hides the amounts",
      detail: "A blend name without an amount per ingredient means you cannot compare the dose to anything else.",
    });
  }
  const foreign = foreignProduct(source);
  if (foreign) gotchas.push(foreign);
  const bluetooth = bluetoothVersions(source);
  if (bluetooth) gotchas.push(bluetooth);

  const order = { high: 0, medium: 1, low: 2 };
  let ordered = uniqueBy(
    gotchas.sort((a, b) => order[a.severity] - order[b.severity]),
    (item) => item.code || item.title,
  );
  if (ordered.some((item) => item.code === "battery")) {
    ordered = ordered.filter((item) => item.code !== "up_to");
  }
  return ordered.slice(0, 8);
}

export function batteryInflation(scrape) {
  const texts = [
    ...(scrape.bullets || []).map((text) => norm(text)),
    ...(scrape.specs || []).map((spec) => norm(`${spec.name}: ${spec.value}`)),
  ];
  const hits = [];
  for (const text of texts) {
    if (!/battery|playback|playtime|listening/i.test(text)) continue;
    for (const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:hours|hrs|hr|h)\b/gi)) {
      const hours = Number(match[1]);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 500) continue;
      const around = text.slice(Math.max(0, (match.index || 0) - 48), (match.index || 0) + match[0].length + 16);
      if (/fast charg/i.test(around) && /minut/i.test(around)) continue;
      hits.push({ hours, text, conditional: /\b(?:up\s*to|upto)\b/i.test(text) });
    }
  }
  const uniqueHours = [...new Set(hits.map((hit) => hit.hours))];
  if (uniqueHours.length < 2) return null;
  const max = Math.max(...uniqueHours);
  const min = Math.min(...uniqueHours);
  if (max < 20 || max < min * 2) return null;
  const naked = hits.some((hit) => hit.hours === max && !/\bcase\b/i.test(hit.text));
  if (!naked) return null;
  const qualified = hits.some((hit) => hit.hours === min && /earbud|\bbuds?\b|earpiece/i.test(hit.text));
  if (qualified) {
    return {
      code: "battery",
      severity: "high",
      title: "The big battery number is not the earbuds",
      detail: `One line offers up to ${max} hours. The listing also states about ${min} hours for the earbuds themselves. The larger figure includes the case, and the ad copy does not say so.`,
    };
  }
  return {
    code: "battery",
    severity: "medium",
    title: "Battery life is stated two ways",
    detail: `The page uses both ${min} hours and ${max} hours for battery without saying which figure is the earbuds, the case, or a quick charge.`,
  };
}

function findConflicts(scrape) {
  const buckets = { Capacity: [], Power: [] };
  const texts = [
    ...(scrape.specs || []).map((spec) => `${spec.name}: ${spec.value}`),
    ...(scrape.bullets || []),
  ];
  for (const text of texts) {
    for (const match of text.matchAll(/\b(\d{3,6})\s*mAh\b/gi)) buckets.Capacity.push(Number(match[1]));
    if (/power|watt|output|charging/i.test(text)) {
      for (const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*W\b/g)) buckets.Power.push(Number(match[1]));
    }
  }
  const conflicts = [];
  for (const [name, values] of Object.entries(buckets)) {
    const unique = [...new Set(values.filter((value) => value > 0))];
    if (unique.length < 2) continue;
    const max = Math.max(...unique);
    const min = Math.min(...unique);
    if (max < min * 1.5) continue;
    conflicts.push({
      code: `conflict-${name.toLowerCase()}`,
      severity: "high",
      title: `Two different ${name.toLowerCase()} figures`,
      detail: `The page says ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")} for ${name.toLowerCase()}. One of them is the number that will not survive a comparison.`,
    });
  }
  return conflicts;
}

function foreignProduct(scrape) {
  const title = `${scrape.title || ""} ${scrape.brand || ""}`.toLowerCase();
  const found = [];
  for (const bullet of scrape.bullets || []) {
    for (const match of bullet.matchAll(/\b([A-Z][A-Za-z0-9.+]*\s+[A-Z][A-Za-z0-9.+]*)\b/g)) {
      const phrase = match[1];
      if (phrase.length < 5 || title.includes(phrase.toLowerCase())) continue;
      if (!/[+\d]/.test(phrase)) continue;
      found.push(phrase);
    }
  }
  const unique = [...new Set(found)];
  if (!unique.length) return null;
  return {
    code: "foreign_product",
    severity: "high",
    title: "The bullets name a different product",
    detail: `The listing is “${scrape.title || "this product"}”, but the bullets talk about ${unique.slice(0, 2).join(" and ")}.`,
  };
}

function bluetoothVersions(scrape) {
  const blob = [
    scrape.title,
    ...(scrape.bullets || []),
    ...(scrape.specs || []).map((spec) => `${spec.name} ${spec.value}`),
  ].join("\n");
  const versions = [...blob.matchAll(/bluetooth\s*[:\-]?\s*(\d(?:\.\d)?)/gi)].map((match) => match[1]);
  const unique = [...new Set(versions)];
  if (unique.length < 2) return null;
  return {
    code: "bluetooth_versions",
    severity: "high",
    title: "Two Bluetooth versions",
    detail: `The page says Bluetooth ${unique.join(" and ")}. One of those numbers belongs to a different line of copy.`,
  };
}

function extraSignals(scrape) {
  const price = money(scrape.price?.raw);
  const compare = money(scrape.price?.compareAtRaw);
  return {
    steepDiscount: Boolean(price && compare && compare >= price * 2),
    price: norm(scrape.price?.raw),
    compareAt: norm(scrape.price?.compareAtRaw),
    subscription: Boolean(scrape.subscription),
    urgency: norm(scrape.urgency),
  };
}

function collectBetterment({ gaps, gotchas, seller, battery, category }) {
  const items = [];
  for (const gap of gaps) {
    items.push({
      title: `Ask for ${gap.charAt(0).toLowerCase()}${gap.slice(1)}`,
      detail: "A listing you can compare states this in the spec table, not in a lifestyle sentence.",
    });
  }
  if (battery) {
    items.push({
      title: "Compare earbud hours, not case hours",
      detail: "Use the smaller battery figure, at a stated volume and codec, when you line this up against another pair.",
    });
  }
  if (seller.flags.some((flag) => flag.code === "third_party" || flag.code === "no_warranty" || flag.code === "short_warranty")) {
    items.push({
      title: "Prefer a named warrantor",
      detail: "Buy the listing that says who repairs it and for how many months, in the country where you live.",
    });
  }
  if (gotchas.some((gotcha) => gotcha.code === "no_refund" || gotcha.code === "opened" || gotcha.code === "short_returns")) {
    items.push({
      title: "Confirm the return in the buy box",
      detail: "The return that matters is the one next to the price, including whether you can open the product.",
    });
  }
  if (category === "skincare") {
    items.push({
      title: "Buy the concentration, not the claim",
      detail: "The comparable fact is the ingredient and its percent. A dermatologist line without a citation is advertising.",
    });
  }
  return uniqueBy(items, (item) => item.title).slice(0, 5);
}

function collectQuestions({ seller, battery, gaps, reviews, category }) {
  const questions = [];
  if (seller.flags.some((flag) => /warranty|lifetime/.test(flag.code) || flag.code === "third_party")) {
    questions.push("Who is the warrantor, how many months does it last, and is it serviced in this country?");
  }
  if (battery || gaps.some((gap) => /battery/i.test(gap))) {
    questions.push("What is the battery life with the stated codec, volume, and noise cancelling on?");
  }
  if (seller.flags.some((flag) => /return|refund|opened/.test(flag.code))) {
    questions.push("Can this be returned after it has been opened, and who pays the return shipping?");
  }
  if (reviews.flags.some((flag) => flag.code === "polarization" || flag.code === "duplicate" || flag.code === "burst")) {
    questions.push("Do the recent 1-star reviews describe the same failure, and is that failure still current?");
  }
  if (category === "apparel") {
    questions.push("What is the fabric composition, and what are the garment measurements for this size?");
  }
  if (category === "skincare" || category === "supplement") {
    questions.push("What is the amount of each active ingredient per use, and who tested it?");
  }
  for (const gap of gaps) {
    if (questions.length >= 5) break;
    questions.push(`Where on the listing is the ${gap.toLowerCase()}?`);
  }
  return uniqueBy(questions.map((text) => ({ text })), (item) => item.text)
    .map((item) => item.text)
    .slice(0, 5);
}

function limitsFor(scrape) {
  const limits = [
    "Only the text loaded in this page was read. Reviews behind a click, and specs printed inside images, were not.",
    "Slogan detection is tuned for English listings.",
    "The score comes from these rules, so it stays the same no matter which model you attach later.",
  ];
  if ((scrape.badges || []).length) {
    limits.push("Marketplace badges on this page were ignored as evidence.");
  }
  if ((scrape.limits || []).length) limits.push(...scrape.limits);
  return limits;
}

function severityRank(severity) {
  return { high: 3, medium: 2, low: 1 }[severity] || 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function truncate(text) {
  const value = norm(text);
  return value.length > 220 ? `${value.slice(0, 217)}…` : value;
}
