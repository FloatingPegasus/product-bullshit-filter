import { collectMarks } from "../lib/marks.js";
import { refineWithLlm } from "../lib/llm.js";
import { buildReport } from "../lib/report.js";
import { loadSettings } from "../lib/settings.js";
import { renderReport } from "./render.js";

const statusEl = document.querySelector("#status");
const reportEl = document.querySelector("#report");
const introEl = document.querySelector("#intro");
const pageNow = document.querySelector("#page-now");
const modelState = document.querySelector("#model-state");
const urlInput = document.querySelector("#url");

let busy = false;
let live = null;

document.querySelector("#url-form").addEventListener("submit", (event) => {
  event.preventDefault();
  openAndFilter(urlInput.value);
});
document.querySelector("#filter-tab").addEventListener("click", () => filterActiveTab());
document.querySelector("#sample-shady").addEventListener("click", () => showFixture("earbuds"));
document.querySelector("#sample-clean").addEventListener("click", () => showFixture("power-bank"));
document.querySelector("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "FILTER_PENDING") consumePending();
});
chrome.tabs.onActivated.addListener(() => refreshTabLabel());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.status === "complete") refreshTabLabel();
});

refreshTabLabel();
refreshModelState();
restoreLast();
consumePending();

async function refreshModelState() {
  const settings = await loadSettings();
  const name = settings.llmEnabled && settings.apiKey ? settings.model || settings.provider : "";
  modelState.textContent = name
    ? `Model on · ${name}. Page text is sent only when a model pass runs.`
    : "Local rules. Model off. Page text stays in this browser.";
}

async function refreshTabLabel() {
  const tab = await activeTab();
  if (!tab) {
    pageNow.textContent = "No tab yet";
    return;
  }
  pageNow.textContent = tab.url ? hostOf(tab.url) : "This tab";
  if (!urlInput.value && tab.url && /^https?:/i.test(tab.url)) urlInput.value = tab.url;
}

async function restoreLast() {
  const stored = await chrome.storage.session.get("last");
  if (!stored.last?.report) return;
  live = stored.last.live || null;
  showReport(stored.last.report);
}

async function consumePending() {
  const stored = await chrome.storage.session.get("pending");
  const pending = stored.pending;
  if (!pending || Date.now() - pending.at > 20000) return;
  await chrome.storage.session.remove("pending");
  if (pending.navigate && pending.url) await openAndFilter(pending.url);
  else if (pending.tabId) await filterTab(pending.tabId);
}

async function openAndFilter(raw) {
  let target;
  try {
    target = new URL(String(raw || "").trim());
  } catch {
    setStatus("That is not a valid URL.", true);
    return;
  }
  if (!/^https?:$/.test(target.protocol)) {
    setStatus("Use an http or https listing.", true);
    return;
  }
  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("No tab to open.", true);
    return;
  }
  const same = tab.url === target.href;
  if (!same) {
    const loaded = waitForLoad(tab.id);
    await chrome.tabs.update(tab.id, { url: target.href, active: true });
    setStatus("Opening the page…");
    try {
      await loaded;
    } catch (error) {
      setStatus(error.message || "The page did not finish loading.", true);
      return;
    }
  }
  await filterTab(tab.id);
}

async function filterActiveTab() {
  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("Open a product page first.", true);
    return;
  }
  await filterTab(tab.id);
}

async function filterTab(tabId) {
  if (busy) return;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/i.test(tab.url)) {
    setStatus("Open a product page. Browser screens and the Chrome Web Store can't be scraped.", true);
    return;
  }
  busy = true;
  setBusy(true);
  setStatus("Reading the page…");
  try {
    const scrape = await scrapeTab(tabId);
    setStatus("Separating specs from copy…");
    const report = buildReport(scrape);
    live = { tabId, url: tab.url };
    showReport(report);
    await remember(report, scrape);
    const settings = await loadSettings();
    if (settings.llmEnabled && settings.autoRefine && settings.apiKey) {
      await runModel(scrape, report, settings);
    } else {
      setStatus(report.product.title ? "Local pass done." : "Local pass done. This page had very little product text.");
    }
  } catch (error) {
    setStatus(error?.message || "Could not read that page.", true);
  } finally {
    busy = false;
    setBusy(false);
  }
}

async function showFixture(name) {
  setStatus("Loading the sample…");
  const response = await fetch(chrome.runtime.getURL(`fixtures/${name}.json`));
  const scrape = await response.json();
  live = null;
  const report = buildReport(scrape);
  showReport(report);
  await remember(report, scrape);
  setStatus(name === "earbuds" ? "Sample listing. Nothing was scraped." : "Clean sample. Nothing was scraped.");
}

function showReport(report) {
  introEl.hidden = true;
  reportEl.hidden = false;
  renderReport(reportEl, report, {
    onMark: live ? () => markPage(report) : null,
    onClear: live ? () => clearPage() : null,
    onRefine: () => refineCurrent(report),
  });
}

async function refineCurrent(report) {
  const settings = await loadSettings();
  if (!settings.llmEnabled || !settings.apiKey) {
    setStatus("Turn the model on and add a key under Model.", true);
    return;
  }
  const stored = await chrome.storage.session.get("last");
  const scrape = stored.last?.scrape;
  if (!scrape) {
    setStatus("Filter the page again, then run the model pass.", true);
    return;
  }
  await runModel(scrape, report, settings);
}

async function runModel(scrape, report, settings) {
  setStatus("Asking the model for a structured pass…");
  setBusy(true);
  try {
    const merged = await refineWithLlm(scrape, report, settings);
    showReport(merged);
    await remember(merged, scrape);
    setStatus(merged.engine === "llm" ? "Model pass applied. The score stayed on local rules." : "Model pass returned nothing usable. Local report kept.");
  } catch (error) {
    setStatus(error?.message || "The model pass failed. Local report kept.", true);
  } finally {
    setBusy(false);
  }
}

async function scrapeTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/scrape-page.cjs"],
  });
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__PBF_scrapeDocument(document, location),
  });
  if (!injected?.result) throw new Error("The page returned nothing to filter.");
  return injected.result;
}

async function markPage(report) {
  if (!live?.tabId) return;
  await chrome.scripting.executeScript({
    target: { tabId: live.tabId },
    files: ["content/mark-page.cjs"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: live.tabId },
    func: (marks) => globalThis.__PBF_markDocument(document, marks),
    args: [collectMarks(report)],
  });
  setStatus("Marks are on the page. Amber is copy, green is a spec, red is a review pattern.");
}

async function clearPage() {
  if (!live?.tabId) return;
  await chrome.scripting.executeScript({
    target: { tabId: live.tabId },
    files: ["content/mark-page.cjs"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: live.tabId },
    func: () => globalThis.__PBF_clearMarks(document),
  });
  setStatus("Marks cleared.");
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error("The page took too long. Filter again once it settles."));
    }, 25000);
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") setTimeout(() => finish(resolve), 1600);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}

function setBusy(value) {
  for (const button of document.querySelectorAll("button")) button.disabled = value;
}

async function remember(report, scrape) {
  await chrome.storage.session.set({ last: { report, live, scrape } });
}
