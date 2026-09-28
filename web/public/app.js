import { renderResearch } from './research-render.js';
const $ = selector => document.querySelector(selector);
const form = $('#url-form');
const status = $('#status');
const report = $('#report');
let controller;
let active = 0;

$('#market').addEventListener('change', () => { $('#currency').textContent = { IN: 'INR', US: 'USD', GB: 'GBP' }[$('#market').value]; });
$('#cancel').addEventListener('click', () => controller?.abort());
form.addEventListener('submit', event => {
  event.preventDefault();
  run(async (signal, id) => {
    const response = await fetch('/api/research', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: $('#url').value, needs: $('#needs').value, market: $('#market').value, budget: $('#budget').value === '' ? null : Number($('#budget').value), productHint: $('#product-hint').value }) });
    if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', result;
    const consume = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'progress' && id === active) addStep(event.message);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'result') result = event.result;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) consume(line);
      }
      consume(buffer + decoder.decode());
    } finally { reader.releaseLock(); }
    if (!result) throw new Error('The research connection ended before a report arrived. Please try again.');
    return result;
  });
});

async function run(work) {
  controller?.abort(); controller = new AbortController();
  const id = ++active;
  report.replaceChildren(); report.hidden = true;
  status.textContent = ''; status.className = '';
  $('#step').textContent = 'Starting check…'; $('#progress').hidden = false;
  setBusy(true);
  try {
    const result = await work(controller.signal, id);
    if (id !== active) return;
    renderResearch(report, result);
    report.hidden = false;
    status.textContent = result.mode === 'demo' ? 'Synthetic test data.' : 'Check complete.';
    status.focus({ preventScroll: true });
  } catch (error) {
    if (id !== active) return;
    status.textContent = error.name === 'AbortError' ? 'Check cancelled.' : error.message;
    status.className = error.name === 'AbortError' ? '' : 'error';
    status.focus({ preventScroll: true });
  } finally { if (id === active) { setBusy(false); $('#progress').hidden = true; } }
}
function addStep(message) {
  $('#step').textContent = message;
}
function setBusy(value) {
  form.setAttribute('aria-busy', String(value));
  for (const element of document.querySelectorAll('#url-form input, #url-form textarea, #url-form select, #url-form button')) element.disabled = value;
}
async function loadConfiguration() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error();
    const config = await response.json();
    const missing = [!config.searchConfigured && 'cross-store search', !config.reasoningConfigured && 'AI comparisons'].filter(Boolean);
    $('#connection').hidden = !missing.length;
    $('#connection').textContent = missing.length ? `Listing checks available. Not configured: ${missing.join(' and ')}.` : '';
  } catch { $('#connection').textContent = 'Could not check available services.'; }

}
loadConfiguration();
