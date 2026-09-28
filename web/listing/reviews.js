/** Review-pattern checks. Histogram uses the full rating distribution; phrasing uses only reviews on the page. */

import { jaccard, parseLooseDate } from "./text.js";

const GENERIC =
  /\b(?:great product|good quality|value for money|fast (?:shipping|delivery)|highly recommend|must buy|as described|works as (?:expected|advertised)|love it|perfect product|amazing quality|best purchase|totally worth|five stars|nice product|good product|excellent product|super quality|worth (?:the|every) (?:money|penny)|awesome product)\b/i;

const INCENTIVE =
  /\b(?:vine|in exchange for|received (?:this )?(?:product|item) (?:for )?free|complimentary|early reviewer program)\b/i;

export function analyzeReviews(scrape) {
  const reviews = Array.isArray(scrape.reviews) ? scrape.reviews : [];
  const histogram = normalizeHistogram(scrape.histogram);
  const average = numberOrNull(scrape.rating?.average);
  const count = numberOrNull(scrape.rating?.count);
  const flags = [];

  const polarization = polarizationFlag(histogram, count);
  if (polarization) flags.push(polarization);

  const sweet = sweetFlag(histogram, count);
  if (sweet && !polarization) flags.push(sweet);
  const tiny = tinySweetFlag(histogram, count);
  if (tiny && !sweet && !polarization) flags.push(tiny);

  if (reviews.length >= 4) {
    const duplicates = duplicateFlag(reviews);
    if (duplicates) flags.push(duplicates);
    const generic = genericFlag(reviews);
    if (generic) flags.push(generic);
    const burst = burstFlag(reviews, count);
    if (burst) flags.push(burst);
    const incentive = incentiveFlag(reviews);
    if (incentive) flags.push(incentive);
    const verified = verifiedFlag(reviews);
    if (verified) flags.push(verified);
  }

  let note;
  if (!reviews.length && !histogram.length) {
    note = "No reviews or rating breakdown were on the page.";
  } else if (reviews.length < 4) {
    note = "Too few review texts were loaded to judge phrasing. The star breakdown, if present, is the better signal.";
  } else {
    note = `Phrasing checks use ${reviews.length} reviews loaded on this page${count ? `, out of ${count.toLocaleString("en-US")} ratings` : ""}.`;
  }

  return {
    average,
    count,
    sampleSize: reviews.length,
    histogram,
    flags,
    note,
    risk: reviewRisk(flags),
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeHistogram(histogram) {
  if (!Array.isArray(histogram)) return [];
  const rows = histogram
    .map((row) => ({
      stars: Number(row.stars),
      percent: Number(row.percent),
    }))
    .filter((row) => row.stars >= 1 && row.stars <= 5 && Number.isFinite(row.percent) && row.percent >= 0);
  if (!rows.length) return [];
  const scale = Math.max(...rows.map((row) => row.percent)) <= 1.5 ? 100 : 1;
  return [5, 4, 3, 2, 1]
    .map((stars) => rows.find((row) => row.stars === stars))
    .filter(Boolean)
    .map((row) => ({ stars: row.stars, percent: Math.round(row.percent * scale) }));
}

function share(histogram, stars) {
  return histogram.find((row) => row.stars === stars)?.percent ?? null;
}

function polarizationFlag(histogram, count) {
  if (!histogram.length || (count != null && count < 20)) return null;
  const five = share(histogram, 5);
  const one = share(histogram, 1);
  const middle = [4, 3, 2].reduce((sum, stars) => sum + (share(histogram, stars) ?? 0), 0);
  if (five == null || one == null) return null;
  if (five >= 70 && one >= 10 && middle <= 20) {
    return {
      code: "polarization",
      severity: "high",
      title: "Star bar is polarized",
      detail: `${five}% of ratings are 5 stars and ${one}% are 1 star. Everything between is only ${middle}%. That shape shows up when a listing collects a flood of praise and a smaller group of concrete failures.`,
    };
  }
  return null;
}

function sweetFlag(histogram, count) {
  if (!histogram.length || (count != null && count < 30)) return null;
  const five = share(histogram, 5);
  if (five != null && five >= 85) {
    return {
      code: "sweet",
      severity: "medium",
      title: "Unusually sweet star bar",
      detail: `${five}% of ratings are 5 stars. A distribution that sweet is possible, and it is also what incentivized reviews look like. Read the 1-star texts before trusting the average.`,
    };
  }
  return null;
}

function tinySweetFlag(histogram, count) {
  if (!histogram.length || count == null || count < 5 || count >= 30) return null;
  const five = share(histogram, 5);
  if (five != null && five >= 95) {
    return {
      code: "tiny_sweet",
      severity: "medium",
      title: "Every rating so far is 5 stars",
      detail: `All ${count} ratings are 5 stars. A sample that small and that perfect is not evidence yet.`,
    };
  }
  return null;
}

function duplicateFlag(reviews) {
  const pairs = [];
  for (let i = 0; i < reviews.length; i += 1) {
    for (let j = i + 1; j < reviews.length; j += 1) {
      const left = `${reviews[i].title || ""} ${reviews[i].body || ""}`;
      const right = `${reviews[j].title || ""} ${reviews[j].body || ""}`;
      const score = jaccard(left, right);
      if (score >= 0.62 && left.length > 40 && right.length > 40) {
        pairs.push({ score, quote: (reviews[i].body || reviews[i].title || "").slice(0, 140) });
      }
    }
  }
  if (!pairs.length) return null;
  const worst = pairs.sort((a, b) => b.score - a.score)[0];
  return {
    code: "duplicate",
    severity: pairs.length >= 2 ? "high" : "medium",
    title: pairs.length === 1 ? "Two reviews share the same phrasing" : "Several reviews share the same phrasing",
    detail: `${pairs.length === 1 ? "A pair of" : `${pairs.length} pairs of`} loaded reviews overlap enough to be near-copies.`,
    evidence: worst.quote,
  };
}

function genericFlag(reviews) {
  const positive = reviews.filter((review) => (review.stars ?? 5) >= 4);
  if (positive.length < 4) return null;
  const generic = positive.filter((review) => isGenericReview(review));
  const ratio = generic.length / positive.length;
  if (ratio < 0.5) return null;
  return {
    code: "generic",
    severity: ratio >= 0.7 ? "high" : "medium",
    title: "Praise that never mentions the product",
    detail: `${generic.length} of ${positive.length} positive reviews on this page are short and generic (shipping, "worth it", "as described") and do not name a specific feature.`,
    evidence: (generic[0].body || generic[0].title || "").slice(0, 140),
  };
}

function isGenericReview(review) {
  const text = `${review.title || ""} ${review.body || ""}`.trim();
  if (!text) return true;
  const specific = /\b\d+(?:\.\d+)?\s*(?:mm|mah|w|hz|gb|hour|hours|day|days|month|months)\b|\b(?:ip\d{2}|bluetooth|battery|driver|warranty|seller|broke|died|stopped|defect)\b/i.test(
    text,
  );
  if (specific && text.length > 80) return false;
  if (GENERIC.test(text) && text.length < 220) return true;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length < 12 && !specific;
}

function burstFlag(reviews, count) {
  const dates = reviews.map((review) => parseLooseDate(review.date)).filter(Boolean).sort((a, b) => a - b);
  if (dates.length < 4) return null;
  const spanDays = (dates[dates.length - 1] - dates[0]) / 86400000;
  const newest = dates[dates.length - 1];
  let densest = 0;
  for (const start of dates) {
    const end = start.getTime() + 7 * 86400000;
    const bucket = dates.filter((date) => date.getTime() >= start.getTime() && date.getTime() <= end).length;
    densest = Math.max(densest, bucket);
  }
  const ratio = densest / dates.length;
  if (ratio < 0.6) return null;
  if (spanDays <= 14 && (count == null || count < 40)) return null;
  return {
    code: "burst",
    severity: ratio >= 0.8 ? "high" : "medium",
    title: "Review dates are bunched",
    detail: `${densest} of ${dates.length} dated reviews on this page fall inside a 7-day window${count ? `. The listing shows ${count.toLocaleString("en-US")} ratings overall` : ""}.`,
  };
}

function incentiveFlag(reviews) {
  const hit = reviews.filter((review) => review.incentivized || INCENTIVE.test(`${review.title || ""} ${review.body || ""}`));
  if (!hit.length) return null;
  const ratio = hit.length / reviews.length;
  if (ratio < 0.15 && hit.length < 2) return null;
  return {
    code: "incentivized",
    severity: ratio >= 0.3 ? "high" : "medium",
    title: "Incentivized reviews are in the sample",
    detail: `${hit.length} of ${reviews.length} loaded reviews look exchanged for the product (Vine, free item, or an explicit exchange). They are not the same thing as a paid customer.`,
  };
}

function verifiedFlag(reviews) {
  const known = reviews.filter((review) => review.verified != null);
  if (known.length < 5) return null;
  const verified = known.filter((review) => review.verified).length;
  const ratio = verified / known.length;
  if (ratio >= 0.45) return null;
  return {
    code: "unverified",
    severity: "medium",
    title: "Most loaded reviews are not verified",
    detail: `${verified} of ${known.length} loaded reviews are marked verified. The rest can be written by someone who never bought this listing.`,
  };
}

export function reviewRisk(flags) {
  const weight = { high: 0.45, medium: 0.28, low: 0.12 };
  const total = flags.reduce((sum, flag) => sum + (weight[flag.severity] ?? 0.15), 0);
  return Math.min(1, total);
}
