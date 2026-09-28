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

export function modelEndpoint(settings) {
  let url;
  try { url = new URL(settings.baseUrl); }
  catch { throw new Error("Enter a valid model base URL."); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error("Use HTTPS for the model endpoint, or HTTP on localhost. Keep credentials out of the URL.");
  }
  return url.href.replace(/\/+$/, '');
}

export function hasModelCredentials(settings) {
  if (typeof settings.apiKey === 'string' && settings.apiKey.trim()) return true;
  try {
    const url = new URL(modelEndpoint(settings));
    return settings.provider === 'compatible' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
