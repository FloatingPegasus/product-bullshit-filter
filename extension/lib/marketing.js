/** Classify listing copy into measurable facts vs slogans. */

import { norm } from "./text.js";

const HIGH = [
  { code: "unverifiable_grade", re: /\b(?:military|aircraft|aerospace|hospital|medical|food)-grade\b/i, label: "Grade claim with no standard named" },
  { code: "authority", re: /\b(?:doctor|dermatologist|clinically)\s+(?:recommended|proven|tested)\b|\bclinically proven\b/i, label: "Authority claim with no citation" },
  { code: "guaranteed", re: /\b(?:guaranteed results|risk[- ]free results|100%\s*effective)\b/i, label: "Outcome guarantee" },
  { code: "patent_vague", re: /\bpatented\b/i, label: "Patent claim" },
];

const MEDIUM = [
  { code: "superlative", re: /\b(?:revolutionary|game[- ]?changer|unparalleled|world-class|cutting-edge|state-of-the-art|best[- ]in[- ]class)\b/i, label: "Superlative with no measurement" },
  { code: "ranking", re: /\b(?:#\s*1|no\.?\s*1|number one|best seller|amazon'?s choice)\b/i, label: "Ranking used as a product fact" },
  { code: "ultimate", re: /\b(?:the ultimate|must[- ]have|life[- ]changing|you(?:'|’)ll love)\b/i, label: "Emotional pitch" },
  { code: "universal", re: /\buniversal(?:ly)? compatib|\bworks with (?:all|any|every)\b/i, label: "Compatibility with no model list" },
  { code: "crystal", re: /\b(?:crystal\s*-?\s*clear|studio quality|concert hall|hifi sound|hi-fi sound)\b/i, label: "Listening claim with no measurement" },
];

const LOW = [
  { code: "vague_quality", re: /\b(?:premium|high[- ]quality|superior|enhanced|innovative|ergonomic|durable|ultra)\b/i, label: "Quality adjective" },
  { code: "perfect", re: /\b(?:perfect(?:ly)?|flawless|amazing|incredible|unbelievable)\b/i, label: "Praise adjective" },
];

const STANDARDS = [
  { name: "Ingress protection", re: /\b(IP\d{2})\b/i },
  { name: "Bluetooth", re: /\b(Bluetooth\s*[:\-]?\s*\d(?:\.\d)?(?:\s*(?:LE|ER|EDR))?)\b/i },
  { name: "Wi-Fi", re: /\b(Wi-?Fi\s*[:\-]?\s*\d(?:E)?(?:\s*\(802\.11[^)]+\))?)\b/i },
  { name: "Codec", re: /\b(LDAC|aptX(?:\s*HD|\s*Adaptive)?|LHDC|LC3|SBC|AAC)\b/ },
  { name: "USB", re: /\b(USB-?C|USB4|USB\s*3(?:\.\d)?|Thunderbolt\s*\d)\b/i },
  { name: "Power delivery", re: /\b((?:USB-C\s*)?PD\s*\d(?:\.\d)?)\b/i },
  { name: "Wireless charging", re: /\b(Qi2?)\b/ },
  { name: "Video", re: /\b(HDR10\+?|Dolby Vision|Dolby Atmos)\b/i },
  { name: "Material", re: /\b((?:304|316|18\/10)\s*stainless steel|borosilicate|600D|ABS plastic)\b/i },
];

const UNIT =
  /(\d+(?:\.\d+)?)\s*(mAh|Wh|kWh|W|kW|V|Hz|kHz|MHz|GHz|dB|mm|cm|kg|g|oz|lb|lbs|ml|mL|L|GB|TB|MB|nits?|lm|lumens|RPM|dpi|ms|hours|hrs|hr|h|min|Mbps|Gbps|ANSI|Ohms?|ohms?|Millimetres?|millimetres?|Millimeters?|millimeters?|Milliseconds?|milliseconds?|litres?|Litres?)\b/g;

const UNIT_NAME = [
  { name: "Capacity", test: (unit, ctx) => /mah/.test(unit) || ((/litre/.test(unit) || unit === "l") && /capacit|litre|cooker|jar|\bpack\b/.test(ctx)) },
  { name: "Energy", test: (unit) => unit === "wh" || unit === "kwh" },
  { name: "Power", test: (unit, ctx) => unit === "w" || unit === "kw" || unit === "v" },
  { name: "Driver size", test: (unit, ctx) => (unit === "mm" || /millimet/.test(unit)) && /driver|speaker|dynamic|audio/.test(ctx) },
  { name: "Battery life", test: (unit, ctx) => /^(?:h|hr|hrs|hours)$/.test(unit) && /battery|playback|playtime|listening|earbud|\bbud\b|with case|charging case/.test(ctx) },
  { name: "Weight", test: (unit) => unit === "g" || unit === "kg" || unit === "oz" || unit === "lb" || unit === "lbs" },
  { name: "Brightness", test: (unit) => /nit/.test(unit) || unit === "lm" || unit === "lumens" },
  { name: "Storage", test: (unit, ctx) => /^(?:gb|tb|mb)$/.test(unit) && /storage|ssd|ram|memory|rom/.test(ctx) },
  { name: "Memory", test: (unit, ctx) => /^(?:gb|tb|mb)$/.test(unit) },
  { name: "Frequency", test: (unit) => /hz$/.test(unit) },
  { name: "Latency", test: (unit) => unit === "ms" || unit === "millisecond" || unit === "milliseconds" },
  { name: "Loudness", test: (unit) => unit === "db" },
  { name: "Impedance", test: (unit) => unit === "ohm" || unit === "ohms" },
  { name: "Charge time", test: (unit, ctx) => unit === "min" && /charg/.test(ctx) },
];

function patentIsSpecific(text) {
  return /\bpatent\s*(?:no|number|#)|(?:\b(?:US|EP|WO|IN)\s*)?\d{6,}\b/i.test(text);
}

export function extractMeasurements(text) {
  const source = norm(text);
  const found = [];
  const seen = new Set();

  for (const standard of STANDARDS) {
    const match = source.match(standard.re);
    if (!match) continue;
    const value = norm(match[1]).replace(/([A-Za-z])\s*[:\-]\s*(?=\d)/g, "$1 ");
    const shown = standard.name === "Ingress protection" ? value.toUpperCase() : value;
    const key = `${standard.name}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      name: standard.name,
      value: shown,
      raw: shown,
      conditional: false,
      context: source,
    });
  }

  for (const match of source.matchAll(UNIT)) {
    const number = match[1];
    const unit = match[2];
    const index = match.index ?? 0;
    const window = source.slice(Math.max(0, index - 48), Math.min(source.length, index + match[0].length + 48));
    const after = source.slice(index, Math.min(source.length, index + match[0].length + 28));
    const before = source.slice(Math.max(0, index - 16), index + match[0].length);
    const unitKey = unit.toLowerCase();
    const named = UNIT_NAME.find((entry) => entry.test(unitKey, window.toLowerCase()));
    const name = named?.name || "Measured value";
    let value = `${number} ${canonicalUnit(unit)}`;
    if (name === "Battery life" && /earbud|ear bud|\bbuds?\b/i.test(after)) {
      value = `${value} (earbuds)`;
    } else if (name === "Battery life" && /case/i.test(after)) {
      value = `${value} (with case)`;
    }
    const conditional = /\b(?:up\s*to|upto)\b/i.test(before);
    if (/\d\s*[x×]\s*\d/i.test(window) && /^(?:cm|mm|centimet)/.test(unitKey)) continue;
    const key = `${name}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ name, value, raw: match[0], conditional, context: window });
  }

  return found;
}

function canonicalUnit(unit) {
  const key = unit.toLowerCase();
  if (key === "h" || key === "hr" || key === "hrs" || key === "hours") return "hours";
  if (/^milli(?:metre|meter)s?$/.test(key)) return "mm";
  if (/^milliseconds?$/.test(key)) return "ms";
  if (key === "mah") return "mAh";
  if (key === "wh") return "Wh";
  if (key === "nit" || key === "nits") return "nits";
  if (key === "w") return "W";
  if (key === "gb") return "GB";
  if (key === "tb") return "TB";
  return unit;
}

export function classifyFragment(text) {
  const source = norm(text);
  if (!source) return { kind: "empty", reasons: [], measurements: [] };
  const measurements = extractMeasurements(source);
  const reasons = [];

  for (const rule of HIGH) {
    if (!rule.re.test(source)) continue;
    if (rule.code === "patent_vague" && patentIsSpecific(source)) continue;
    reasons.push({ code: rule.code, label: rule.label, severity: "high" });
  }
  for (const rule of MEDIUM) {
    if (rule.re.test(source)) reasons.push({ code: rule.code, label: rule.label, severity: "medium" });
  }
  for (const rule of LOW) {
    if (rule.re.test(source)) reasons.push({ code: rule.code, label: rule.label, severity: "low" });
  }
  if (/\b(?:up\s*to|upto)\s+\d/i.test(source)) {
    reasons.push({ code: "up_to", label: "Ceiling figure, condition not stated", severity: "medium" });
  }

  const severe = reasons.some((reason) => reason.severity === "high" || reason.severity === "medium");
  let kind = "spec";
  if (measurements.length && (severe || reasons.length)) kind = "mixed";
  else if (!measurements.length && reasons.length) kind = "marketing";
  else if (!measurements.length && reasons.length === 0) {
    kind = looksConcrete(source) ? "spec" : "marketing";
    if (kind === "marketing") {
      reasons.push({ code: "unsupported", label: "No measurement or standard", severity: "low" });
    }
  }

  return { kind, reasons, measurements };
}

function looksConcrete(text) {
  if (STANDARDS.some((standard) => standard.re.test(text))) return true;
  if (/\b\d+(?:\.\d+)?\s*(?:x|×)\s*\d+/i.test(text)) return true;
  if (/\b(?:model|sku|mpn)\b[:\s]*[A-Z0-9-]{4,}/i.test(text)) return true;
  if (/\b\d+(?:\.\d+)?\s*%/.test(text) && !/\bup to\b/i.test(text)) return true;
  return false;
}

export function isMushySpec(name, value) {
  const blob = `${name} ${value}`;
  const classified = classifyFragment(blob);
  if (classified.measurements.length) return false;
  if (classified.reasons.some((reason) => reason.severity !== "low" || reason.code !== "unsupported")) return true;
  return classified.kind !== "spec";
}
