import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../web/server.js';
let base;
before(async () => {
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); });
test('website rejects malformed and oversized requests and does not expose legacy extension UI', async () => {
  const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /Product link/);
  assert.equal((await fetch(`${base}/sidepanel/index.html`)).status, 404);
  assert.equal((await fetch(`${base}/api/research/sample/missing`)).status, 404);
  const headers = { 'content-type': 'application/json' };
  const malformed = await fetch(`${base}/api/research`, { method: 'POST', headers, body: '{broken' });
  assert.equal(malformed.status, 400);
  const tooLarge = await fetch(`${base}/api/research`, { method: 'POST', headers, body: 'x'.repeat(9000) });
  assert.equal(tooLarge.status, 413);
  for (const body of ['null', '{}']) {
    const response = await fetch(`${base}/api/research`, { method: 'POST', headers, body });
    const event = JSON.parse((await response.text()).trim()); assert.equal(event.type, 'error');
  }
});

test('research API exposes configuration flags and bounded streaming failures', async () => {
  const configuration = await (await fetch(`${base}/api/config`)).json();
  assert.equal(typeof configuration.searchConfigured, 'boolean');
  assert.equal(configuration.apiKey, undefined);
  assert.equal((await fetch(`${base}/api/research/sample/power-bank`)).status, 404);
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/json', origin: 'https://hostile.example' }]) {
    const response = await fetch(`${base}/api/research`, { method: 'POST', headers, body: JSON.stringify({ url: 'https://example.com/p' }) });
    assert.equal(response.status, 403);
  }
  const response = await fetch(`${base}/api/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1/admin' }) });
  assert.match(response.headers.get('content-type'), /ndjson/);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type, 'error'); assert.match(events.at(-1).message, /not a public listing/);
  assert.equal(events.some(event => event.type === 'result'), false);
});
