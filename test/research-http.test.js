import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createAppServer } from '../web/server.js';
import { sampleResearch } from '../support/research-fixture.js';

async function serve(server, work) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await work(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const post = (base, body = {}, signal) => fetch(`${base}/api/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

test('research streams progress before the result and keeps provider fields out of config', async () => {
  const server = createAppServer({ configuration: () => ({ searchConfigured: false, reasoningConfigured: false }), research: async (_, { onProgress }) => { onProgress('Reading test fixture'); return sampleResearch('earbuds'); } });
  await serve(server, async base => {
    const response = await post(base); const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events[0].type, 'progress'); assert.equal(events[1].type, 'result');
    assert.equal(events[1].result.mode, 'demo');
    const state = await (await fetch(`${base}/api/config`)).json(); assert.deepEqual(state, { ok: true, searchConfigured: false, reasoningConfigured: false });
  });
});

test('concurrent research is refused and disconnect aborts the active provider work', async () => {
  let abortSeen;
  const aborted = new Promise(resolve => { abortSeen = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const server = createAppServer({ research: async (_, { signal, onProgress }) => {
    onProgress('Synthetic long request'); entered();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => { abortSeen(); reject(new Error('cancelled')); }, { once: true }));
  } });
  await serve(server, async base => {
    const controller = new AbortController();
    const first = await post(base, {}, controller.signal); await started;
    const second = await post(base); assert.equal(second.status, 429);
    controller.abort(); await first.body.cancel().catch(() => {});
    await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Cancellation was not forwarded')), 1500); timer.unref(); })]);
  });
});

test('public deployment checks the HTTPS origin, host and bounded research allowance', async () => {
  let time = 1000;
  let calls = 0;
  const server = createAppServer({ publicOrigin: 'https://product.example', trustProxy: true, hourlyLimit: 1, dailyLimit: 2, now: () => time, research: async () => { calls++; return {}; } });
  await serve(server, async base => {
    const headers = { host: 'product.example', origin: 'https://product.example', 'content-type': 'application/json', 'x-real-ip': '203.0.113.1' };
    const raw = (path, extra = {}, method = 'POST') => new Promise((resolve, reject) => {
      const req = httpRequest(`${base}${path}`, { method, headers: { ...headers, ...extra } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      });
      req.on('error', reject); req.end(method === 'POST' ? '{}' : undefined);
    });
    const request = (extra = {}) => raw('/api/research', extra);
    assert.equal((await raw('/healthz', {}, 'GET')).status, 200);
    assert.equal((await fetch(base)).status, 403);
    assert.equal((await request({ origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request({ origin: 'http://product.example' })).status, 403);
    const good = await request(); assert.equal(good.status, 200); await good.text();
    assert.match(good.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const limited = await request(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '3600');
    const second = await request({ 'x-real-ip': '203.0.113.2' }); assert.equal(second.status, 200); await second.text();
    assert.equal((await request({ 'x-real-ip': '203.0.113.3' })).status, 429);
    time += 86400001;
    const reset = await request(); assert.equal(reset.status, 200); await reset.text();
    assert.equal(calls, 3);
  });
  assert.throws(() => createAppServer({ publicOrigin: 'http://product.example' }), /HTTPS/);
});
