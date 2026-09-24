/** Extension settings. The key stays in chrome.storage.local on this profile. */

export const DEFAULT_SETTINGS = {
  llmEnabled: false,
  autoRefine: false,
  provider: "openai",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

export const PROVIDER_PRESETS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-haiku-latest",
  },
  compatible: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
  },
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

export async function saveSettings(settings) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ settings: next });
  return next;
}
