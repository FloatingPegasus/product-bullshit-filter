import { createRequire } from "node:module";
import { Window } from "happy-dom";
import { buildReport } from "../extension/lib/report.js";

const require = createRequire(import.meta.url);
const { scrapeDocument } = require("../extension/content/scrape-page.cjs");

export function reportFromHtml(html, url) {
  return inspectHtml(html, url).report;
}

export function inspectHtml(html, url) {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      enableJavaScriptEvaluation: false,
    },
  });
  try {
    window.document.write(html);
    const scrape = scrapeDocument(window.document, new URL(url));
    const report = buildReport(scrape);
    for (const node of window.document.querySelectorAll('script, style, nav, footer, iframe, noscript')) node.remove();
    const text = (window.document.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18000);
    return { report, text };
  } finally { window.happyDOM.abort(); window.close(); }
}
