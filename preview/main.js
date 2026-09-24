import { buildReport } from "../extension/lib/report.js";
import { renderReport } from "../extension/sidepanel/render.js";

const statusEl = document.querySelector("#status");
const reportEl = document.querySelector("#report");

async function show(file, label) {
  const scrape = await fetch(file).then((response) => response.json());
  const report = buildReport(scrape, { now: new Date("2026-09-25T00:00:00Z") });
  renderReport(reportEl, report);
  statusEl.textContent = `${label} · bullshit ${report.verdict.score}/100 · ${report.verdict.headline}`;
}

document.querySelector("#sample-shady").addEventListener("click", () => {
  show("../extension/fixtures/earbuds.json", "Shady earbuds");
});
document.querySelector("#sample-clean").addEventListener("click", () => {
  show("../extension/fixtures/power-bank.json", "Clean power bank");
});

show("../extension/fixtures/earbuds.json", "Shady earbuds");
