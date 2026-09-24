/** Outlines specs, slogans, and suspicious review text on the open page. */
function markDocument(doc, marks) {
  clearMarks(doc);
  const style = doc.createElement("style");
  style.id = "pbf-style";
  style.textContent = [
    ".pbf-mark-marketing{outline:2px solid #e7b15a !important;outline-offset:2px;}",
    ".pbf-mark-spec{outline:2px solid #8fbf63 !important;outline-offset:2px;}",
    ".pbf-mark-risk{outline:2px solid #ef6d5c !important;outline-offset:2px;}",
    "#pbf-legend{position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#17150f;color:#f4f0e6;",
    "font:13px/1.4 Avenir Next,Segoe UI,sans-serif;padding:12px 14px;width:220px;border:1px solid #3a3428;",
    "box-shadow:0 10px 30px rgba(0,0,0,.35)}",
    "#pbf-legend strong{display:block;letter-spacing:.12em;font-size:10px;font-weight:700;margin-bottom:6px}",
    "#pbf-legend button{margin-top:8px;background:#f4f0e6;color:#17150f;border:0;padding:6px 10px;cursor:pointer;font:inherit}",
    "#pbf-legend i{display:inline-block;width:8px;height:8px;margin-right:6px}",
  ].join("");
  (doc.head || doc.documentElement).appendChild(style);

  let marked = 0;
  for (const mark of marks || []) {
    if (!mark?.text) continue;
    const el = smallestContaining(doc, mark.text);
    if (!el) continue;
    el.classList.add(`pbf-mark-${mark.kind || "marketing"}`);
    marked += 1;
  }

  const note = doc.createElement("div");
  note.id = "pbf-legend";
  const title = doc.createElement("strong");
  title.textContent = "BULLSHIT FILTER";
  const lines = doc.createElement("div");
  lines.append(
    swatch(doc, "#e7b15a", "Slogan"),
    swatch(doc, "#8fbf63", "Measured spec"),
    swatch(doc, "#ef6d5c", "Review pattern"),
  );
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = marked ? "Clear marks" : "Nothing matched";
  button.addEventListener("click", () => clearMarks(doc));
  note.append(title, lines, button);
  doc.documentElement.appendChild(note);
  return { marked };
}

function swatch(doc, color, label) {
  const row = doc.createElement("div");
  const dot = doc.createElement("i");
  dot.style.background = color;
  row.append(dot, doc.createTextNode(label));
  return row;
}

function clearMarks(doc) {
  doc.getElementById("pbf-style")?.remove();
  doc.getElementById("pbf-legend")?.remove();
  for (const el of doc.querySelectorAll("[class*='pbf-mark-']")) {
    el.classList.remove("pbf-mark-marketing", "pbf-mark-spec", "pbf-mark-risk");
  }
}

function smallestContaining(doc, snippet) {
  const needle = String(snippet).replace(/\s+/g, " ").trim().slice(0, 160);
  if (needle.length < 8) return null;
  let best = null;
  let bestLength = Infinity;
  const nodes = doc.querySelectorAll("li, tr, p, span, div, article");
  for (const el of nodes) {
    if (el.id === "pbf-legend" || el.closest?.("#pbf-legend")) continue;
    const content = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!content.includes(needle)) continue;
    if (content.length < bestLength && content.length < 2500) {
      best = el;
      bestLength = content.length;
    }
  }
  return best;
}

globalThis.__PBF_markDocument = markDocument;
globalThis.__PBF_clearMarks = clearMarks;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { markDocument, clearMarks };
}
