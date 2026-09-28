export function scrapeDocument(doc, loc) {
  const hostname = String(loc?.hostname || "");
  const marketplace = marketplaceFromHost(hostname);
  const out = blankListing(loc, marketplace);
  absorbJsonLd(doc, out);
  if (marketplace === "Amazon") scrapeAmazon(doc, out);
  else if (marketplace === "Flipkart") scrapeFlipkart(doc, out);
  else if (marketplace === "eBay") scrapeEbay(doc, out);
  fillFromDom(doc, out);
  return finish(out);
}

function blankListing(loc, marketplace) {
  return {
    url: String(loc?.href || ""),
    hostname: String(loc?.hostname || ""),
    marketplace,
    title: "",
    brand: "",
    sku: "",
    breadcrumbs: [],
    price: { raw: "", compareAtRaw: "" },
    availability: "",
    badges: [],
    rating: { average: null, count: null },
    histogram: [],
    bullets: [],
    description: "",
    specs: [],
    seller: { name: "", fulfilledBy: "", rating: "", raw: "" },
    warranty: "",
    returns: "",
    reviews: [],
    variant: "",
    urgency: "",
    subscription: false,
    limits: [],
  };
}

function scrapeAmazon(doc, out) {
  setField(out, "title", text(doc.querySelector("#productTitle")));
  setField(out, "brand", cleanBrand(text(doc.querySelector("#bylineInfo, a#brand, #brand"))));
  const priceRoot = doc.querySelector("#corePriceDisplay_desktop_feature_div, #corePrice_feature_div, #apex_desktop") || doc;
  const priceNode = [...priceRoot.querySelectorAll(".a-price .a-offscreen")].find((node) => !node.closest(".a-text-price"));
  const price = text(priceNode);
  if (price) out.price.raw = price;
  const strike = text(doc.querySelector(".a-price.a-text-price .a-offscreen, span[data-a-strike='true'] .a-offscreen"));
  if (strike && strike !== out.price.raw) out.price.compareAtRaw = strike;
  setField(out, "availability", text(doc.querySelector("#availability")));
  setField(out, "variant", text(doc.querySelector("#variation_color_name .selection, #inline-twister-expanded-dimension-text-color_name")));

  const featureList = doc.querySelector("#feature-bullets ul, #productFactsDesktopExpander ul");
  if (featureList) {
    const items = listItems(featureList);
    if (items.length) out.bullets = items;
  }

  for (const table of doc.querySelectorAll("#productDetails_techSpec_section_1, #productDetails_detailBullets_sections1, table.prodDetTable")) {
    out.specs.push(...tableSpecs(table));
  }
  out.specs.push(...detailBulletSpecs(doc));

  const description = text(doc.querySelector("#productDescription"));
  if (description) out.description = description.slice(0, 4000);

  const sellerLink = text(doc.querySelector("#sellerProfileTriggerId, a[id*='seller']"));
  const merchant = merchantText(doc);
  const parsed = parseMerchant(merchant);
  if (sellerLink) out.seller.name = cleanSeller(sellerLink);
  else if (parsed.name) out.seller.name = parsed.name;
  if (parsed.fulfilledBy) out.seller.fulfilledBy = parsed.fulfilledBy;
  if (parsed.raw) out.seller.raw = parsed.raw;

  const returns = text(doc.querySelector("#RETURNS_POLICY, #returns-policy-popover-text, #productSupportAndReturnPolicy-return-policy-anchor-text"));
  if (returns) out.returns = returns;

  const ratingLabel = doc.querySelector("#acrPopover")?.getAttribute("title") || text(doc.querySelector("[data-hook='rating-out-of-text']"));
  const average = parseStars(ratingLabel);
  if (average != null) out.rating.average = average;
  const count = parseCount(text(doc.querySelector("#acrCustomerReviewText")));
  if (count != null) out.rating.count = count;
  const histogram = amazonHistogram(doc);
  if (histogram.length) out.histogram = histogram;

  out.reviews.push(...reviewsFrom(doc));
  out.breadcrumbs = crumbs(doc, "#wayfinding-breadcrumbs_feature_div a, #nav-subnav a");
  out.badges = badgeTexts(doc, "#acBadge_feature_div, #zeitgeistBadge_feature_div");
  if (doc.querySelector("#aplus, #aplus_feature_div, #aplusBrandStory_feature_div")) {
    out.limits.push("Brand storytelling modules were on the page and were not treated as specs.");
  }
  const zone = doc.querySelector("#desktop_buybox, #buybox, #ppd") || doc.body;
  absorbCommerceSignals(zone, out);
}

function scrapeFlipkart(doc, out) {
  const h1 = text(doc.querySelector("span.VU-ZEz, h1.yhB1nd, .B_NuCI, h1"));
  const og = norm(doc.querySelector("meta[property='og:title']")?.getAttribute("content"));
  if (/\bmore$/i.test(h1) && og) setField(out, "title", og.split(/ price in india/i)[0]);
  else setField(out, "title", h1);
  const price = text(doc.querySelector("div.Nx9bqj, div._30jeq3")) || firstRupee(doc);
  if (price) out.price.raw = price;
  const sellerLink = text(doc.querySelector("a[href*='/seller/']"));
  const sellerLine = norm(doc.body?.textContent || "").match(/Seller:\s*([A-Za-z0-9][A-Za-z0-9.&'-]{1,40}?)(?=\s+See\b|See other|$)/);
  if (sellerLink) out.seller.name = cleanSeller(sellerLink);
  else if (sellerLine) out.seller.name = cleanSeller(sellerLine[1]);
  const warranty = findShortText(doc, /\d+\s*(?:years?|months?|days?)\s+[A-Za-z ]{0,48}warrant(?:y)?(?:\s+from\s+the\s+date\s+of\s+purchase)?/i);
  if (warranty) out.warranty = warranty;
  const returns = findShortText(doc, /\d+\s*days?\s+(?:replacement|returns?|refund)/i);
  if (returns) out.returns = returns;
  const ratingLine = norm(doc.body?.textContent || "").match(/(\d\.\d)\s*\|?\s*(\d{1,3}(?:,\d{3})+)/);
  if (ratingLine) {
    out.rating.average = parseStars(ratingLine[1]);
    out.rating.count = parseCount(ratingLine[2]);
  }
  out.reviews.push(...reviewsFrom(doc));
}

function firstRupee(doc) {
  for (const el of doc.querySelectorAll("div, span")) {
    if (el.children.length) continue;
    const value = norm(el.textContent);
    if (/^₹[\d,]+(?:\.\d+)?$/.test(value)) return value;
  }
  return "";
}

function findShortText(doc, pattern) {
  for (const el of doc.querySelectorAll("div, p, span, li")) {
    if (el.children.length > 2) continue;
    const value = norm(el.textContent);
    if (value.length < 8 || value.length > 220) continue;
    const match = value.match(pattern);
    if (match) return norm(match[0]);
  }
  return "";
}

function pairedSpecs(doc) {
  const nav = /^(login|more|home|cart|search|minutes|grocery|travel|flipkart|offer zone)$/i;
  const specs = [];
  for (const el of doc.querySelectorAll("div")) {
    if (el.closest("nav, header, footer")) continue;
    if (el.children.length !== 2) continue;
    if (el.children[0].querySelector("div, a")) continue;
    const name = norm(el.children[0].textContent);
    const value = norm(el.children[1].textContent);
    if (!name || !value || name.length < 3 || name.length > 48 || value.length > 200) continue;
    if (nav.test(name) || /^\d(?:\.\d)?$/.test(name) || /^delivery by$/i.test(name)) continue;
    if (value === "/" || /sign up|my profile|wishlist|advertise on/i.test(value)) continue;
    specs.push({ name, value, source: "spec table" });
  }
  return specs;
}

function scrapeEbay(doc, out) {
  setField(out, "title", text(doc.querySelector("h1.x-item-title__mainTitle, h1")));
  const price = text(doc.querySelector(".x-price-primary"));
  if (price) out.price.raw = price;
  const seller = text(doc.querySelector(".x-sellercard-atf__info__about-seller, .ux-seller-section__item--seller a"));
  if (seller) out.seller.name = cleanSeller(seller);
}

function fillFromDom(doc, out) {
  if (!out.title) {
    setField(
      out,
      "title",
      cleanTitle(
        doc.querySelector("meta[property='og:title']")?.getAttribute("content") ||
          text(doc.querySelector("h1")) ||
          doc.title,
      ),
    );
  }
  if (!out.brand) {
    setField(out, "brand", doc.querySelector("meta[property='product:brand'], [itemprop='brand']")?.getAttribute("content") || text(doc.querySelector("[itemprop='brand']")));
  }
  if (!out.price.raw) {
    const meta = doc.querySelector("meta[property='product:price:amount']")?.getAttribute("content");
    const visible = text(doc.querySelector("[itemprop='price']"));
    const currency = doc.querySelector("meta[property='product:price:currency']")?.getAttribute("content") || "";
    out.price.raw = norm([currency, meta || visible].filter(Boolean).join(" "));
  }
  if (!out.description) {
    const block = text(doc.querySelector("[itemprop='description']"));
    const meta = doc.querySelector("meta[name='description']")?.getAttribute("content");
    out.description = (block || norm(meta)).slice(0, 4000);
  }
  if (!out.bullets.length) {
    const best = bestList(doc);
    if (best.length) out.bullets = best;
  }
  out.specs.push(...allTableSpecs(doc));
  out.specs.push(...definitionSpecs(doc));
  if (out.specs.filter(usefulSpec).length < 3) out.specs.push(...pairedSpecs(doc).filter(usefulSpec));
  if (!out.reviews.length) out.reviews.push(...reviewsFrom(doc));
  if (!out.histogram.length) out.histogram = genericHistogram(doc);
  if (out.rating.average == null) {
    const average = parseStars(
      doc.querySelector("[itemprop='ratingValue']")?.getAttribute("content") || text(doc.querySelector("[itemprop='ratingValue']")),
    );
    if (average != null) out.rating.average = average;
  }
  if (out.rating.count == null) {
    const count = parseCount(
      doc.querySelector("[itemprop='reviewCount'], [itemprop='ratingCount']")?.getAttribute("content") ||
        text(doc.querySelector("[itemprop='reviewCount'], [itemprop='ratingCount']")),
    );
    if (count != null) out.rating.count = count;
  }
  if (!out.breadcrumbs.length) out.breadcrumbs = crumbs(doc, "[aria-label*='breadcrumb' i] a, nav.breadcrumb a");
  if (!out.warranty) out.warranty = policyText(doc, /^warranty\b/i);
  if (!out.returns) out.returns = policyText(doc, /^(returns?|replacement|refund policy)\b/i);
  if (!out.seller.name) {
    const sold = policyText(doc, /^(seller|sold by)\b/i);
    if (sold) out.seller.name = cleanSeller(sold.replace(/^sold by\s*/i, "").split(/[.|,]/)[0]);
  }
  absorbCommerceSignals(doc.querySelector("#desktop_buybox, #buybox, #offer-display-features, [itemprop='offers']"), out);
  pullPoliciesFromSpecs(out);
}

function absorbJsonLd(doc, out) {
  const scripts = doc.querySelectorAll("script[type='application/ld+json']");
  const products = [];
  for (const script of scripts) {
    const raw = script.textContent || "";
    if (!raw.trim()) continue;
    try {
      collectProducts(JSON.parse(raw), products);
    } catch {
      /* a broken block should not sink the rest of the page */
    }
  }
  for (const product of products) {
    setField(out, "title", plain(product.name));
    setField(out, "brand", cleanBrand(plain(product.brand?.name || product.brand)));
    setField(out, "sku", plain(product.sku || product.mpn));
    const offer = first(product.offers) || {};
    const price = offer.price ?? offer.lowPrice;
    if (price != null && price !== "" && !out.price.raw) {
      out.price.raw = norm([offer.priceCurrency, price].filter((part) => part != null && part !== "").join(" "));
    }
    if (!out.availability && offer.availability) {
      out.availability = String(offer.availability).split("/").pop().replace(/([a-z])([A-Z])/g, "$1 $2");
    }
    const seller = plain(offer.seller?.name || offer.seller);
    if (seller && !out.seller.name) out.seller.name = cleanSeller(seller);
    const rating = product.aggregateRating || {};
    if (out.rating.average == null && rating.ratingValue != null) out.rating.average = parseStars(rating.ratingValue);
    if (out.rating.count == null) out.rating.count = parseCount(rating.reviewCount ?? rating.ratingCount);
    if (!out.description && product.description) out.description = norm(plain(product.description)).slice(0, 4000);
    for (const prop of asArray(product.additionalProperty)) {
      const name = plain(prop.name);
      const value = plain(prop.value);
      if (name && value) out.specs.push({ name, value, source: "page data" });
    }
    for (const review of asArray(product.review)) {
      const body = plain(review.reviewBody || review.description);
      const title = plain(review.name || review.headline);
      if (!body && !title) continue;
      out.reviews.push({
        stars: parseStars(review.reviewRating?.ratingValue),
        title: title || "",
        body: norm(body).slice(0, 1200),
        date: plain(review.datePublished) || "",
        verified: null,
        author: plain(review.author?.name || review.author) || "",
        incentivized: /vine|in exchange for|free product/i.test(`${title} ${body}`),
      });
    }
  }
}

function collectProducts(node, products) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectProducts(item, products);
    return;
  }
  const types = asArray(node["@type"]).map((type) => String(type).toLowerCase());
  if (types.some((type) => type === "product" || type.endsWith("/product"))) products.push(node);
  if (node["@graph"]) collectProducts(node["@graph"], products);
}

function finish(out) {
  out.title = cleanTitle(out.title);
  out.brand = cleanBrand(out.brand);
  out.bullets = uniqueStrings(out.bullets).slice(0, 25);
  out.specs = dedupeSpecs(out.specs).slice(0, 80);
  out.reviews = dedupeReviews(out.reviews).slice(0, 20);
  out.histogram = dedupeHistogram(out.histogram);
  out.badges = uniqueStrings(out.badges).slice(0, 6);
  out.breadcrumbs = uniqueStrings(out.breadcrumbs).slice(0, 8);
  pullPoliciesFromSpecs(out);
  if (out.description && out.title) {
    const description = norm(out.description).toLowerCase();
    const title = norm(out.title).toLowerCase();
    if (description.startsWith(title.slice(0, 48)) && description.length < title.length + 80) out.description = "";
  }
  if (!out.limits.some((line) => /reviews/i.test(line))) {
    out.limits.unshift("Only reviews already loaded in the page were read, not the full review set.");
  }
  return out;
}

function pullPoliciesFromSpecs(out) {
  if (!out.warranty) {
    const row = out.specs.find((spec) => /^warranty\b/i.test(spec.name));
    if (row) out.warranty = row.value;
  }
  if (!out.returns) {
    const row = out.specs.find((spec) => /^(returns?|replacement|refund)\b/i.test(spec.name));
    if (row) out.returns = row.value;
  }
}

function absorbCommerceSignals(root, out) {
  if (!root) return;
  const text = norm(root.textContent || "").slice(0, 5000);
  if (!out.urgency) {
    const urgency = text.match(/only\s+\d+\s+left(?:\s+in\s+stock)?/i);
    if (urgency) out.urgency = urgency[0];
  }
  if (!out.subscription && /subscribe\s*(?:&|and)\s*save/i.test(text)) out.subscription = true;
}

function amazonHistogram(doc) {
  const box = doc.querySelector("#histogramTable, [data-hook='cr-ratings-histogram'], #cm_cr_dp_d_rating_histogram");
  const rows = [];
  const labels = (box || doc).querySelectorAll("[aria-label], .a-histogram-row a, .a-histogram-row, [data-hook='histogram-row']");
  for (const el of labels) {
    const label = el.getAttribute("aria-label") || "";
    const match = label.match(/(\d+)\s*percent of reviews have (\d)\s*stars?/i);
    if (match) rows.push({ stars: Number(match[2]), percent: Number(match[1]) });
  }
  if (rows.length) return rows;
  if (!box) return [];
  const meters = [...box.querySelectorAll(".a-meter-bar")];
  if (meters.length === 5) {
    return meters
      .map((el, index) => {
        const match = (el.getAttribute("style") || "").match(/(\d+(?:\.\d+)?)%/);
        return match ? { stars: 5 - index, percent: Math.round(Number(match[1])) } : null;
      })
      .filter(Boolean);
  }
  return [];
}

function genericHistogram(doc) {
  const rows = [];
  for (const tr of doc.querySelectorAll("table tr")) {
    const cells = [...tr.querySelectorAll("th, td")].map((cell) => norm(cell.textContent));
    if (cells.length < 2) continue;
    const stars = cells[0].match(/^([1-5])\s*stars?$/i);
    const percent = cells[1].match(/(\d+(?:\.\d+)?)%/);
    if (stars && percent) rows.push({ stars: Number(stars[1]), percent: Math.round(Number(percent[1])) });
  }
  return rows;
}

function reviewsFrom(doc) {
  const all = [...doc.querySelectorAll("[data-hook='review'], [itemprop='review']")];
  const roots = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  return roots.map(reviewFromElement).filter((review) => review.body || review.title);
}

function reviewFromElement(el) {
  const bodyNode = el.querySelector("[data-hook='review-body'], [data-hook='reviewText'], [itemprop='reviewBody']");
  const body = reviewBodyText(bodyNode);
  const titleNode = el.querySelector("[data-hook='review-title'], [data-hook='reviewTitle'], [itemprop='name']");
  let title = "";
  if (titleNode) {
    const spans = [...titleNode.querySelectorAll("span")].map((span) => norm(span.textContent)).filter(Boolean);
    title = spans.length ? spans[spans.length - 1] : norm(titleNode.textContent);
    title = title.replace(/^\d(?:\.\d)?\s+out of 5 stars\s*/i, "");
  }
  const starText =
    el.querySelector("[data-hook='review-star-rating'] .a-icon-alt, [data-hook='review-star-rating']")?.textContent ||
    el.querySelector("[itemprop='ratingValue']")?.getAttribute("content") ||
    el.querySelector("[itemprop='ratingValue']")?.textContent ||
    "";
  const dateNode = el.querySelector("[data-hook='review-date'], [itemprop='datePublished']");
  const date = dateNode?.getAttribute("content") || dateNode?.getAttribute("datetime") || text(dateNode);
  const verifiedText = text(el.querySelector("[data-hook='avp-badge']"));
  const author = authorFrom(el);
  const blob = `${title} ${body}`;
  return {
    stars: parseStars(starText),
    title,
    body: body.slice(0, 1200),
    date,
    verified: verifiedText ? /verified/i.test(verifiedText) : null,
    author,
    incentivized: /vine|in exchange for|received this product for free|complimentary/i.test(blob),
  };
}

function tableSpecs(table) {
  if (!table) return [];
  return rowsToSpecs(table.querySelectorAll("tr"), "spec table").filter(usefulSpec);
}

function allTableSpecs(doc) {
  const specs = [];
  for (const table of doc.querySelectorAll("table")) {
    if (table.closest("[data-hook='review'], [itemprop='review'], nav, header, footer, #aplus, #aplus_feature_div")) continue;
    const cls = `${table.className || ""} ${table.id || ""}`;
    if (/emi|plans-table|reinventprice/i.test(cls)) continue;
    const rows = rowsToSpecs(table.querySelectorAll("tr"), "spec table").filter(usefulSpec);
    if (rows.length >= 2 && !rows.every((row) => /star/i.test(row.name))) specs.push(...rows);
  }
  return specs;
}

function usefulSpec(spec) {
  const blob = `${spec.name} ${spec.value}`;
  if (/replacement reason|replacement period|replacement policy|^unit count$|^number of items$/i.test(blob)) return false;
  if (/best sellers rank|customer reviews|^asin$|date first available|contact information|^packer contact|^manufacturer contact|^importer contact|feedback|^emi\b/i.test(spec.name)) return false;
  if (/function\s*\(|P\.when\(|var\s+dp/i.test(spec.value)) return false;
  return true;
}

function merchantText(doc) {
  const selectors = ["#merchant-info", "#tabular-buybox", "#desktop_buybox", "#buybox", "#merchantInfoFeature_feature_div"];
  for (const selector of selectors) {
    const raw = text(doc.querySelector(selector));
    if (/ships from|sold by/i.test(raw)) return raw.slice(0, 2000);
  }
  return "";
}

function reviewBodyText(node) {
  if (!node) return "";
  const clone = node.cloneNode(true);
  clone.querySelectorAll(".a-hidden, .a-teaser-describedby-collapsed, .a-teaser-describedby-expanded").forEach((el) => el.remove());
  return norm(clone.textContent)
    .replace(/brief content visible, double tap to read full content\.?/gi, "")
    .replace(/full content visible, double tap to read brief content\.?/gi, "")
    .replace(/(?:\s*read more|\s*read less)+\s*$/i, "")
    .trim();
}

function authorFrom(el) {
  const named = text(el.querySelector(".a-profile-name, [itemprop='author']"));
  if (named) return named;
  const widget = text(el.querySelector("[data-hook='genome-widget']"));
  if (widget && widget.length <= 40 && !/helpful|report|people found/i.test(widget)) return widget;
  return "";
}

function rowsToSpecs(rows, source) {
  const specs = [];
  for (const tr of rows) {
    const cells = [...tr.querySelectorAll("th, td")].map((cell) => norm(cell.textContent)).filter(Boolean);
    if (cells.length < 2) continue;
    if (cells[0].length > 60 || cells[1].length > 300) continue;
    specs.push({ name: cells[0].replace(/[:\s]+$/, ""), value: cells[1], source });
  }
  return specs;
}

function detailBulletSpecs(doc) {
  const specs = [];
  const items = doc.querySelectorAll("#detailBullets_feature_div li, #productDetails_detailBullets_sections1 li");
  for (const li of items) {
    const bold = li.querySelector(".a-text-bold, b, strong");
    if (!bold) continue;
    const name = norm(bold.textContent).replace(/[:\s]+$/, "");
    const value = norm(li.textContent).replace(norm(bold.textContent), "").replace(/^[:\s]+/, "");
    if (name && value && name.length <= 60 && value.length <= 300 && usefulSpec({ name, value })) {
      specs.push({ name, value, source: "spec table" });
    }
  }
  return specs;
}

function definitionSpecs(doc) {
  const specs = [];
  for (const list of doc.querySelectorAll("dl")) {
    if (list.closest("nav, header, footer, [itemprop='review']")) continue;
    const terms = [...list.querySelectorAll("dt")];
    for (const term of terms) {
      const valueNode = term.nextElementSibling;
      if (!valueNode || valueNode.tagName.toLowerCase() !== "dd") continue;
      const name = norm(term.textContent);
      const value = norm(valueNode.textContent);
      if (name && value && name.length <= 60) specs.push({ name, value, source: "spec table" });
    }
  }
  return specs;
}

function bestList(doc) {
  let best = [];
  let bestScore = 0;
  for (const list of doc.querySelectorAll("ul, ol")) {
    if (list.closest("nav, header, footer, [data-hook='review'], [itemprop='review']")) continue;
    const items = listItems(list);
    if (items.length < 3) continue;
    let score = items.length;
    const heading = norm(list.previousElementSibling?.textContent || "");
    if (/highlight|feature|about this item|overview|description/i.test(heading)) score += 20;
    if (score > bestScore) {
      best = items;
      bestScore = score;
    }
  }
  return best;
}

function listItems(list) {
  return [...list.querySelectorAll("li")]
    .filter((item) => item.parentElement === list)
    .map((item) => {
      const span = [...item.children].find((child) => child.classList?.contains("a-list-item"));
      return norm((span || item).textContent);
    })
    .filter((item) => item.length > 8 && item.length < 500 && !JUNK.test(item));
}

function policyText(doc, pattern) {
  const nodes = doc.querySelectorAll("h1, h2, h3, h4, h5, summary, th, dt, strong, span, div, p, label");
  for (const node of nodes) {
    if (node.children.length > 2) continue;
    const label = norm(node.textContent);
    if (label.length < 3 || label.length > 42 || !pattern.test(label)) continue;
    const sibling = node.nextElementSibling;
  if (sibling) {
      const body = norm(sibling.textContent);
      const tab = /^(manufacturer info|specifications|description|showcase|reviews|warranty|highlights)$/i.test(body);
      if (!tab && body.length > 12 && body.length < 1600 && (/\d/.test(body) || body.length > 40)) return body;
    }
    if (/^sold by\b/i.test(label)) return label;
  }
  return "";
}

function crumbs(doc, selector) {
  return uniqueStrings([...doc.querySelectorAll(selector)].map((node) => norm(node.textContent)).filter((item) => item && item.length < 40));
}

function badgeTexts(doc, selector) {
  return [...doc.querySelectorAll(selector)]
    .map((node) => norm(node.textContent))
    .filter((item) => item && item.length < 80);
}

function parseMerchant(value) {
  const raw = norm(value);
  const ships = raw.match(/ships from:?\s+(.+?)(?=\s+sold by\b|$)/i);
  const sold = raw.match(/sold by:?\s+(.+?)(?=\s+(?:gift options|payment|add to|returns|ships from|secure transaction)\b|$)/i);
  const fulfilledBy = ships ? cleanSeller(ships[1]) : "";
  const name = sold ? cleanSeller(sold[1]) : "";
  return {
    name,
    fulfilledBy,
    raw: [fulfilledBy && `Ships from ${fulfilledBy}`, name && `Sold by ${name}`].filter(Boolean).join(" ") || raw.slice(0, 240),
  };
}

function dedupeSpecs(specs) {
  const seen = new Set();
  const out = [];
  for (const spec of specs) {
    const name = norm(spec.name);
    const value = norm(spec.value);
    if (!name || !value) continue;
    const key = `${name.toLowerCase()}::${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, value, source: spec.source || "page" });
  }
  return out;
}

function dedupeReviews(reviews) {
  const out = [];
  for (const review of reviews) {
    const body = norm(review.body || review.title).toLowerCase();
    if (!body) continue;
    const existing = out.find((item) => {
      const other = norm(item.body || item.title).toLowerCase();
      if (other.slice(0, 100) !== body.slice(0, 100)) return false;
      const left = norm(item.author).toLowerCase();
      const right = norm(review.author).toLowerCase();
      if (left && right && left !== right) return false;
      return true;
    });
    if (!existing) {
      out.push(review);
      continue;
    }
    if (!norm(existing.author) && norm(review.author)) existing.author = review.author;
    if (!norm(existing.date) && norm(review.date)) existing.date = review.date;
    if (!norm(existing.title) && norm(review.title)) existing.title = review.title;
    if (existing.stars == null && review.stars != null) existing.stars = review.stars;
    if (existing.verified == null && review.verified != null) existing.verified = review.verified;
    if (review.incentivized) existing.incentivized = true;
    if (norm(review.body).length > norm(existing.body).length) existing.body = review.body;
  }
  return out;
}

function dedupeHistogram(rows) {
  const byStar = new Map();
  for (const row of rows) {
    const stars = Number(row.stars);
    const percent = Number(row.percent);
    if (stars >= 1 && stars <= 5 && Number.isFinite(percent)) byStar.set(stars, { stars, percent });
  }
  return [...byStar.values()];
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = norm(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function setField(out, key, value) {
  const next = norm(value);
  if (next) out[key] = next;
}

function text(node) {
  return norm(node?.textContent || "");
}

function norm(value) {
  return String(value ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plain(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return norm(value);
  return "";
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanTitle(value) {
  return norm(value).replace(/\.{2,}\s*more$/i, "").replace(/…\s*more$/i, "").replace(/\s+[|\-–—]\s+(?:amazon(?:\.[a-z.]+)?|flipkart|ebay|walmart).*$/i, "");
}

function cleanBrand(value) {
  return norm(value)
    .replace(/^visit the\s+/i, "")
    .replace(/\s+store$/i, "")
    .replace(/^brand:\s*/i, "");
}

function cleanSeller(value) {
  return norm(value)
    .replace(/^sold by\s*/i, "")
    .replace(/\s+store$/i, "")
    .replace(/[.\s]+$/, "");
}

function parseStars(value) {
  if (value == null || value === "") return null;
  const text = String(value);
  const labeled = text.match(/(\d(?:\.\d)?)\s*(?:out of\s*5)?/);
  if (!labeled) return null;
  const stars = Number(labeled[1]);
  if (stars >= 0 && stars <= 5) return stars;
  return null;
}

function parseCount(value) {
  if (value == null || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function marketplaceFromHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  const table = [
    [/^amazon\./, "Amazon"],
    [/^amzn\./, "Amazon"],
    [/^flipkart\./, "Flipkart"],
    [/^ebay\./, "eBay"],
    [/^walmart\./, "Walmart"],
    [/^etsy\./, "Etsy"],
    [/^bestbuy\./, "Best Buy"],
    [/^target\./, "Target"],
    [/^myntra\./, "Myntra"],
    [/^ajio\./, "Ajio"],
    [/^croma\./, "Croma"],
    [/^reliancedigital\./, "Reliance Digital"],
    [/^snapdeal\./, "Snapdeal"],
    [/^meesho\./, "Meesho"],
    [/^newegg\./, "Newegg"],
  ];
  for (const [pattern, name] of table) {
    if (pattern.test(host)) return name;
  }
  if (!host) return "This page";
  const label = host.split(".")[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "This page";
}

const JUNK = /^(see more|read more|about this item|sponsored|make sure this fits(?: by entering your model number)?|customer reviews|back to top)$/i;
