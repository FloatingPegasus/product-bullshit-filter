import { renderReport } from "/sidepanel/render.js";

const form = document.querySelector("#url-form");
const urlInput = document.querySelector("#url");
const statusEl = document.querySelector("#status");
const reportEl = document.querySelector("#report");
const buttons = [...document.querySelectorAll("button")];

form.addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeUrl(urlInput.value);
});

document.querySelector("#sample-shady").addEventListener("click", () => showSample("earbuds", "Shady sample. Nothing was fetched."));
document.querySelector("#sample-clean").addEventListener("click", () => showSample("power-bank", "Clean sample. Nothing was fetched."));

async function analyzeUrl(raw) {
  setBusy(true);
  setStatus("Fetching the page…");
  try {
    const payload = await postJson("/api/analyze", { url: raw });
    showReport(payload.report);
    setStatus(`${payload.report.product.marketplace} · bullshit ${payload.report.verdict.score}/100`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function showSample(name, message) {
  setBusy(true);
  setStatus("Loading the sample…");
  try {
    const payload = await getJson(`/api/sample/${name}`);
    showReport(payload.report);
    setStatus(`${message} Score ${payload.report.verdict.score}/100.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function showReport(report) {
  reportEl.hidden = false;
  renderReport(reportEl, report);
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readPayload(response);
}

async function getJson(path) {
  return readPayload(await fetch(path));
}

async function readPayload(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}

function setBusy(value) {
  for (const button of buttons) button.disabled = value;
  urlInput.disabled = value;
}
