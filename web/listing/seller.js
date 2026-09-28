/** Seller, warranty, and returns. Absence is only treated as a fact when the rest of the buy box was visible. */

import { norm } from "./text.js";
import { WARRANTY_FLOOR_DAYS } from "./category.js";

const MARKETPLACE_SELLER = /^(amazon(\.com|\.in)?|flipkart|walmart|ebay|target|best buy|croma|reliance digital|myntra)$/i;

export function analyzeSeller(scrape, category) {
  const sellerName = norm(scrape.seller?.name);
  const fulfilledBy = norm(scrape.seller?.fulfilledBy);
  const warranty = norm(scrape.warranty);
  const returns = norm(scrape.returns);
  const warrantyDays = parseDurationDays(warranty);
  const returnDays = parseDurationDays(returns);
  const flags = [];
  const buyBoxVisible = Boolean(sellerName || fulfilledBy || warranty || returns || scrape.seller?.raw);

  if (!buyBoxVisible) {
    flags.push({
      code: "unseen",
      severity: "low",
      title: "Seller terms were not on the page",
      detail: "No seller, warranty, or return text was visible. Open those sections and filter again before treating them as missing.",
    });
  } else {
    if (!sellerName) {
      flags.push({
        code: "no_seller",
        severity: "medium",
        title: "Seller name is missing",
        detail: "The page names terms without saying who you are actually buying from.",
      });
    } else if (!isMarketplace(sellerName) && !isMarketplace(fulfilledBy)) {
      flags.push({
        code: "third_party",
        severity: "medium",
        title: "A third party is the seller",
        detail: `${sellerName} is selling this${fulfilledBy ? `, fulfilled by ${fulfilledBy}` : ""}. Returns can still be real, but warranty claims often bounce between the storefront and the marketplace.`,
      });
    } else if (sellerName && fulfilledBy && !isMarketplace(sellerName) && isMarketplace(fulfilledBy)) {
      flags.push({
        code: "marketplace_fulfilled",
        severity: "low",
        title: "Sold by a third party, shipped by the marketplace",
        detail: `${sellerName} is the seller. ${fulfilledBy} handling delivery makes returns easier than a pure third-party shipment, and it does not make them the warrantor.`,
      });
    }

    if (!warranty) {
      if (WARRANTY_FLOOR_DAYS[category] > 0) {
        flags.push({
          code: "no_warranty",
          severity: "medium",
          title: "Warranty is not stated",
          detail: "Nothing on the page names a duration or a warrantor. For this kind of product that is part of the purchase, not a footnote.",
        });
      }
    } else {
      flags.push(...warrantyFlags(warranty, warrantyDays, category));
    }

    if (!returns) {
      flags.push({
        code: "no_returns",
        severity: category === "apparel" ? "high" : "medium",
        title: "Return window is not stated",
        detail: "The listing never says how long you have to send it back, or whether opened items qualify.",
      });
    } else {
      flags.push(...returnFlags(returns, returnDays));
    }
  }

  return {
    name: sellerName,
    fulfilledBy,
    rating: norm(scrape.seller?.rating),
    warranty,
    returns,
    warrantyDays,
    returnDays,
    flags,
    risk: sellerRisk(flags),
  };
}

function isMarketplace(name) {
  return MARKETPLACE_SELLER.test(norm(name));
}

export function parseDurationDays(text) {
  const source = norm(text);
  if (!source) return null;
  if (/\blifetime\b/i.test(source)) return null;
  const match = source.match(/(\d+)\s*-?\s*(day|days|week|weeks|month|months|year|years|yr|yrs)\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("day")) return count;
  if (unit.startsWith("week")) return count * 7;
  if (unit.startsWith("month")) return count * 30;
  return count * 365;
}

function warrantyFlags(warranty, days, category) {
  const flags = [];
  if (/\blifetime\b/i.test(warranty)) {
    flags.push({
      code: "lifetime",
      severity: "medium",
      title: "Lifetime warranty is undefined here",
      detail: "The listing says lifetime without naming the warrantor or what event ends the life of the product. Treat it as a slogan until those two things are written down.",
    });
  }
  if (/\bno international\b|\binternational warranty (?:is )?void\b|\bwarranty void outside\b/i.test(warranty)) {
    flags.push({
      code: "intl",
      severity: "low",
      title: "Warranty does not travel",
      detail: "The page says the warranty is not international. If you are outside the seller's country, assume you will pay for the repair.",
    });
  }
  const floor = WARRANTY_FLOOR_DAYS[category] ?? 90;
  if (days != null && floor > 0 && days < floor) {
    flags.push({
      code: "short_warranty",
      severity: days < 90 ? "high" : "medium",
      title: "Warranty is short for this product",
      detail: `The stated warranty works out to about ${days} days. A careful listing in this category usually clears ${floor} days and names who honors it.`,
    });
  }
  if (days == null && !/\blifetime\b/i.test(warranty)) {
    flags.push({
      code: "vague_warranty",
      severity: "medium",
      title: "Warranty has no duration",
      detail: `The page mentions a warranty ("${truncate(warranty)}") and never says how long it lasts.`,
    });
  }
  return flags;
}

function returnFlags(returns, days) {
  const flags = [];
  if (/\b(final sale|non-?returnable|not eligible for (?:a )?refund|no refund)\b/i.test(returns)) {
    flags.push({
      code: "no_refund",
      severity: "high",
      title: "Returns are restricted or refused",
      detail: `The listing says: "${truncate(returns)}"`,
    });
  } else if (/\bopened\b/i.test(returns) && /\b(not eligible|no return|cannot be returned|won't be accepted)\b/i.test(returns)) {
    flags.push({
      code: "opened",
      severity: "high",
      title: "Opened items cannot be returned",
      detail: "You can inspect the seal and not the product. That matters for anything you have to wear, hear, or charge to judge.",
    });
  }
  if (/\brestocking\b/i.test(returns)) {
    flags.push({
      code: "restock",
      severity: "medium",
      title: "A restocking fee is mentioned",
      detail: truncate(returns),
    });
  }
  if (days != null && days < 14 && !flags.some((flag) => flag.code === "no_refund" || flag.code === "opened")) {
    flags.push({
      code: "short_returns",
      severity: "medium",
      title: "Return window is under two weeks",
      detail: `The page gives about ${days} days. That is tight if a defect shows up after a few uses.`,
    });
  }
  return flags;
}

function sellerRisk(flags) {
  const weight = { high: 0.45, medium: 0.25, low: 0.1 };
  const total = flags.reduce((sum, flag) => sum + (weight[flag.severity] ?? 0.1), 0);
  return Math.min(1, total);
}

function truncate(text) {
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}
