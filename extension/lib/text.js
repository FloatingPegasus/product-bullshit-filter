/** Shared string helpers. Used by the local filter and the model-output sanitizer. */

export function norm(value) {
  return String(value ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function lower(value) {
  return norm(value).toLowerCase();
}

export function sentences(value) {
  return norm(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 20);
}

export function tokenize(value) {
  return lower(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);
}

export function jaccard(left, right) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function parseStars(value) {
  if (value == null || value === "") return null;
  const text = String(value);
  const labeled = text.match(/(\d(?:\.\d)?)\s*(?:out of\s*5)?\s*stars?/i);
  if (labeled) {
    const stars = Number(labeled[1]);
    if (stars >= 0 && stars <= 5) return stars;
  }
  const bare = Number(text);
  if (Number.isFinite(bare) && bare >= 0 && bare <= 5) return bare;
  return null;
}

export function parseCount(value) {
  if (value == null || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

const MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

export function parseLooseDate(value) {
  const text = norm(value).replace(/reviewed in .+? on /i, "");
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (dmy && MONTHS[dmy[2].toLowerCase()] != null) {
    return utc(Number(dmy[3]), MONTHS[dmy[2].toLowerCase()], Number(dmy[1]));
  }
  const mdy = text.match(/\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (mdy && MONTHS[mdy[1].toLowerCase()] != null) {
    return utc(Number(mdy[3]), MONTHS[mdy[1].toLowerCase()], Number(mdy[2]));
  }
  return null;
}

function utc(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export function numbersIn(value) {
  return [...String(value ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

export function compact(value) {
  return lower(value).replace(/[^a-z0-9.]+/g, "");
}

export function corpusContains(corpus, snippet) {
  const needle = lower(snippet).replace(/[^a-z0-9.%]+/g, " ").replace(/\s+/g, " ").trim();
  if (needle.length < 8) return false;
  const hay = lower(corpus).replace(/[^a-z0-9.%]+/g, " ").replace(/\s+/g, " ");
  return hay.includes(needle);
}

export function buildCorpus(scrape) {
  const reviews = (scrape.reviews || []).map((review) =>
    [review.title, review.body, review.date, review.author].filter(Boolean).join(" "),
  );
  const specs = (scrape.specs || []).map((spec) => `${spec.name}: ${spec.value}`);
  return [
    scrape.title,
    scrape.brand,
    scrape.price?.raw,
    scrape.price?.compareAtRaw,
    scrape.availability,
    scrape.warranty,
    scrape.returns,
    scrape.seller?.name,
    scrape.seller?.fulfilledBy,
    scrape.seller?.raw,
    scrape.description,
    ...(scrape.bullets || []),
    ...specs,
    ...reviews,
    ...(scrape.badges || []),
  ]
    .filter(Boolean)
    .join("\n");
}

export function money(value) {
  if (!value) return null;
  const match = String(value).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
