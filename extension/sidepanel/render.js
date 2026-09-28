import { reportToPlainText } from "../lib/plain.js";

export function renderReport(mount, report, handlers = {}) {
  mount.replaceChildren(sheet(report, handlers));
}

function sheet(report, handlers) {
  const band = report.verdict.band || "mixed";
  const nodes = [
    verdict(report, band),
    productLine(report),
    meters(report.verdict.breakdown || []),
    differentiators(report.differentiators || []),
    gotchas(report.gotchas || []),
    disclosure("Specs and marketing", [split(report)]),
    disclosure("Seller, warranty and returns", [sellerBlock(report.seller)]),
    disclosure("Review evidence", [reviewBlock(report.reviews)]),
    disclosure("Questions before buying", [betterment(report.betterment || []), questions(report.questions || [])]),
    disclosure("Method and limitations", [limits(report.limits || [], report)]),
    actions(report, handlers),
  ];
  return el("article", { class: "sheet" }, nodes);
}

function disclosure(title, children) {
  return el("details", {class: "report-detail"}, [el("summary", {}, title), ...children]);
}

function verdict(report, band) {
  return el("header", { class: `verdict band-${band}` }, [
    el("div", {}, [
      el("p", { class: "stamp" }, stampLabel(band)),
      el("h2", { class: "headline" }, report.verdict.headline || "Report"),
      el("p", { class: "summary" }, report.verdict.summary || ""),
    ]),
    el("div", { class: "score" }, [
      el("span", { class: "score-kicker" }, "Bullshit"),
      el("span", { class: "score-num" }, String(report.verdict.score ?? "–")),
      el("span", { class: "score-den" }, "/ 100"),
    ]),
  ]);
}

function stampLabel(band) {
  return {
    substance: "More measurable",
    mixed: "Mixed",
    marketing: "Heavy copy",
    walkaway: "High uncertainty",
  }[band] || "Report";
}

function productLine(report) {
  const product = report.product || {};
  const bits = [product.marketplace, report.category && report.category !== "general" ? report.category : "", product.price, product.variant]
    .filter(Boolean)
    .join(" · ");
  const children = [el("strong", {class: "product-title"}, product.title || "Listing"), el("span", {}, bits)];
  if (product.url && /^https?:/i.test(product.url)) {
    children.push(document.createTextNode(" · "));
    children.push(el("a", { href: product.url, target: "_blank", rel: "noreferrer" }, shortUrl(product.url)));
  }
  return el("p", { class: "product-line" }, children);
}

function meters(rows) {
  return el(
    "section",
    { class: "block" },
    rows.map((row) => {
      const ratio = row.max ? row.points / row.max : 0;
      const tone = ratio >= 0.6 ? "hot" : ratio <= 0.25 ? "cool" : "";
      return el("div", { class: "meter" }, [
        el("div", { class: "meter-top" }, [
          el("span", {}, row.label),
          el("span", {}, `${trimNumber(row.points)}/${row.max}`),
        ]),
        el("span", { class: "meter-track" }, [
          el("span", { class: `meter-fill ${tone}`.trim(), style: `width:${Math.round(ratio * 100)}%` }),
        ]),
        el("p", { class: "meter-note" }, row.note || ""),
      ]);
    }),
  );
}

function differentiators(items) {
  const note = "Stated by the listing; not independently verified.";
  const body = items.length
    ? [
        el(
          "ol",
          { class: "diffs" },
          items.map((item) =>
            el("li", {}, [
              el("span", { class: "rank" }, String(item.rank).padStart(2, "0")),
              el("div", {}, [
                el("strong", { class: "diff-title" }, item.title),
                el("p", { class: "detail" }, item.detail),
                item.evidence ? el("p", {class: "quote"}, item.evidence) : null,
              ]),
            ]),
          ),
        ),
      ]
    : [el("p", { class: "empty" }, "Nothing on this page is specific enough to compare.")];
  return block("Comparable facts", note, body);
}

function split(report) {
  return el("section", { class: "block split" }, [
    column("Specs", "spec", report.specs || [], (spec) =>
      el("li", {}, [
        el("span", { class: "pill spec" }, "spec"),
        el("div", {}, [
          el("strong", { class: "item-title" }, `${spec.name}: ${spec.value}`),
          el("p", { class: "detail" }, spec.source || ""),
        ]),
      ]),
    ),
    column("Marketing", "mkt", report.marketing || [], (item) =>
      el("li", {}, [
        el("span", { class: `pill ${item.severity || "low"}` }, item.severity || "low"),
        el("div", {}, [
          el("strong", { class: "item-title" }, item.text),
          el("p", { class: "detail" }, item.reason || ""),
        ]),
      ]),
    ),
  ]);
}

function column(title, tone, items, renderItem) {
  return el("div", {}, [
    el("div", { class: "split-head" }, [
      el("h3", {}, title),
      el("span", { class: "src" }, String(items.length)),
    ]),
    items.length
      ? el("ul", { class: "stack" }, items.slice(0, 12).map(renderItem))
      : el("p", { class: "empty" }, tone === "spec" ? "No measured specs on the page." : "No slogan lines detected."),
  ]);
}

function sellerBlock(seller = {}) {
  const rows = [
    ["Seller", seller.name],
    ["Fulfilled by", seller.fulfilledBy],
    ["Seller rating", seller.rating],
    ["Warranty", seller.warranty],
    ["Returns", seller.returns],
  ].filter((row) => row[1]);
  const facts = rows.length
    ? el(
        "dl",
        { class: "seller" },
        rows.map(([label, value]) =>
          el("div", { class: "seller-row" }, [el("dt", {}, label), el("dd", {}, value)]),
        ),
      )
    : el("p", { class: "empty" }, "Seller, warranty, and returns were not on the page.");
  const flags = (seller.flags || []).map((flag) => flagItem(flag));
  return block("Seller, warranty, returns", "", [facts, flags.length ? el("ul", { class: "flags" }, flags) : null]);
}

function reviewBlock(reviews = {}) {
  const head = reviews.note || "";
  const average = reviews.average != null ? `${reviews.average} average` : "";
  const count = reviews.count != null ? `${Number(reviews.count).toLocaleString("en-US")} ratings` : "";
  const meta = [average, count].filter(Boolean).join(" · ");
  const flags = (reviews.flags || []).length
    ? el(
        "ul",
        { class: "flags" },
        reviews.flags.map((flag) => flagItem(flag)),
      )
    : el("p", { class: "empty" }, "No suspicious pattern in the reviews this page actually loaded.");
  return block("Review patterns", [meta, head].filter(Boolean).join(" — "), [histogram(reviews.histogram || []), flags]);
}

function histogram(rows) {
  if (!rows.length) return null;
  const ordered = [...rows].sort((a, b) => b.stars - a.stars);
  return el(
    "div",
    { class: "hist" },
    ordered.map((row) =>
      el("div", { class: "hist-row" }, [
        el("span", { class: "hist-label" }, String(row.stars)),
        el("span", { class: "hist-track" }, [
          el("span", { class: "hist-fill", style: `width:${Math.max(2, Math.min(100, row.percent))}%` }),
        ]),
        el("span", { class: "hist-pct" }, `${row.percent}%`),
      ]),
    ),
  );
}

function gotchas(items) {
  const body = items.length
    ? [el("ul", { class: "flags" }, items.map((item) => flagItem(item)))]
    : [el("p", { class: "empty" }, "No gotchas from these rules.")];
  return block("Gotchas", "", body);
}

function betterment(items) {
  const body = items.length
    ? [
        el(
          "ul",
          { class: "stack" },
          items.map((item) =>
            el("li", {}, [
              el("span", { class: "pill spec" }, "next"),
              el("div", {}, [el("strong", { class: "item-title" }, item.title), el("p", { class: "detail" }, item.detail)]),
            ]),
          ),
        ),
      ]
    : [el("p", { class: "empty" }, "The listing already states the facts this category needs.")];
  return block("What to verify", "", body);
}

function questions(items) {
  const body = items.length
    ? [el("ul", { class: "questions" }, items.map((question) => el("li", {}, question)))]
    : [el("p", { class: "empty" }, "Nothing specific to ask. The page already answers the usual gaps.")];
  return block("Ask before you pay", "", body);
}

function limits(items, report) {
  const engine = report.engine === "llm"
    ? "Narrative from the model. Score stayed on local rules."
    : "Local rules only. Nothing on this page was sent to a model.";
  const extra = report.llmNote ? el("p", { class: "footer-note" }, report.llmNote) : null;
  return block("Limits", engine, [
    el("ul", { class: "limits" }, items.map((item) => el("li", { class: "limit" }, item))),
    extra,
  ]);
}

function actions(report, handlers) {
  const buttons = [
    el("button", { type: "button", onclick: (event) => copyReport(report, event.currentTarget) }, "Copy report"),
  ];
  if (handlers.onMark) buttons.push(el("button", { type: "button", onclick: handlers.onMark }, "Mark page"));
  if (handlers.onClear) buttons.push(el("button", { type: "button", onclick: handlers.onClear }, "Clear marks"));
  if (handlers.onRefine) buttons.push(el("button", { type: "button", onclick: handlers.onRefine }, "Run model pass"));
  return el("div", { class: "report-actions" }, buttons);
}

function flagItem(flag) {
  return el("li", { class: "flag" }, [
    el("span", { class: `pill ${flag.severity || "low"}` }, flag.severity || "low"),
    el("div", {}, [
      el("strong", {}, flag.title),
      el("p", { class: "detail" }, flag.detail || ""),
      flag.evidence ? el("p", { class: "quote" }, flag.evidence) : null,
    ]),
  ]);
}

function block(title, note, children) {
  return el("section", { class: "block" }, [
    el("h3", {}, title),
    note ? el("p", { class: "note" }, note) : null,
    ...children,
  ]);
}

async function copyReport(report, button) {
  try {
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(reportToPlainText(report));
    button.textContent = "Copied";
  } catch { button.textContent = "Copy unavailable — select report text"; }
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 28 ? `${parsed.pathname.slice(0, 28)}…` : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

function trimNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "onclick" && typeof value === "function") node.addEventListener("click", value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
