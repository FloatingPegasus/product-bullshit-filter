import { PROVIDER_PRESETS, loadSettings, saveSettings, modelEndpoint, hasModelCredentials } from "../lib/settings.js";

const form = document.querySelector("#settings");
const enabled = document.querySelector("#llm-enabled");
const autoRefine = document.querySelector("#auto-refine");
const provider = document.querySelector("#provider");
const baseUrl = document.querySelector("#base-url");
const model = document.querySelector("#model");
const apiKey = document.querySelector("#api-key");
const statusEl = document.querySelector("#status");

loadSettings().then((settings) => {
  enabled.checked = settings.llmEnabled;
  autoRefine.checked = settings.autoRefine;
  provider.value = settings.provider;
  baseUrl.value = settings.baseUrl;
  model.value = settings.model;
  apiKey.value = settings.apiKey;
});

provider.addEventListener("change", () => {
  const preset = PROVIDER_PRESETS[provider.value];
  if (!preset) return;
  apiKey.value = "";
  baseUrl.value = preset.baseUrl;
  model.value = preset.model;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const settings = current();
    modelEndpoint(settings);
    await saveSettings(settings);
    setStatus("Saved in this browser.");
  } catch (error) { setStatus(error.message || "Could not save settings.", true); }
});

document.querySelector("#test").addEventListener("click", async () => {
  const settings = current();
  if (!hasModelCredentials(settings)) {
    setStatus("Add a key first.", true);
    return;
  }
  setStatus("Contacting the provider…");
  try {
    const message = await testConnection(settings);
    setStatus(message);
  } catch (error) {
    setStatus(error.message || "Connection failed.", true);
  }
});

function current() {
  return {
    llmEnabled: enabled.checked,
    autoRefine: autoRefine.checked,
    provider: provider.value,
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
    apiKey: apiKey.value.trim(),
  };
}

async function testConnection(settings) {
  const base = modelEndpoint(settings);
  if (settings.provider === "anthropic") {
    const response = await fetch(`${base}/v1/messages`, {
      signal: AbortSignal.timeout(20000),
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with the word ok." }],
      }),
    });
    if (!response.ok) throw new Error(await errorText(response));
    return "Anthropic accepted the key.";
  }
  const response = await fetch(`${base}/models`, {
    signal: AbortSignal.timeout(20000),
    headers: settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {},
  });
  if (!response.ok) throw new Error(await errorText(response));
  return "The provider accepted the key.";
}

async function errorText(response) {
  const payload = await response.json().catch(() => ({}));
  const message = payload?.error?.message || response.statusText || "Request failed";
  return `${response.status}: ${String(message).slice(0, 180)}`;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
