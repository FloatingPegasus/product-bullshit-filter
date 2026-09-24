/** Turn fetched HTML into the same report the extension builds. */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { buildReport } from "../extension/lib/report.js";
import { fetchListing } from "./fetch-page.js";

const require = createRequire(import.meta.url);
const { scrapeDocument } = require("../extension/content/scrape-page.cjs");

export async function analyzeUrl(rawUrl, options) {
  const fetched = await fetchListing(rawUrl, options);
  return {
    report: reportFromHtml(fetched.html, fetched.finalUrl),
    finalUrl: fetched.finalUrl,
  };
}

export function reportFromHtml(html, url) {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  window.document.write(html);
  const scrape = scrapeDocument(window.document, new URL(url));
  return buildReport(scrape);
}

export async function analyzeFixture(name) {
  const allowed = new Set(["earbuds", "power-bank"]);
  if (!allowed.has(name)) {
    const error = new Error("Unknown sample.");
    error.status = 404;
    throw error;
  }
  const fileUrl = new URL(`../extension/fixtures/${name}.json`, import.meta.url);
  const scrape = JSON.parse(await readFile(fileUrl, "utf8"));
  return buildReport(scrape);
}
