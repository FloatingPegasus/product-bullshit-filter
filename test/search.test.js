import test from 'node:test';
import assert from 'node:assert/strict';
import { providerConfig, providerStatus, searchWeb } from '../web/research/providers.js';

const config = { searchBaseUrl: 'http://product-search:8080', searchKey: 'synthetic-reserve-key' };
const row = { url: 'https://shop.example/product', title: 'Product', content: '<b>Public product description</b>' };

test('private search works without a subscription and never receives the reserve credential', async () => {
  const events = [];
  const results = await searchWeb('product', 'GB', config, { onSearch: event => events.push(event), fetchImpl: async (url, request) => {
    assert.equal(String(url), 'http://product-search:8080/search');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(JSON.stringify(request).includes(config.searchKey), false);
    assert.equal(request.redirect, 'error');
    const body = new URLSearchParams(request.body);
    assert.equal(body.get('q'), 'product'); assert.equal(body.get('language'), 'en-GB'); assert.equal(body.get('format'), 'json');
    return Response.json({ results: [row], unresponsive_engines: [] });
  } });
  assert.equal(results[0].snippet, 'Public product description');
  assert.deepEqual(events, [{ provider: 'SearXNG', partial: false, fallback: false }]);
  assert.equal(providerStatus(providerConfig({ SEARXNG_URL: config.searchBaseUrl })).searchConfigured, true);
});

test('failed or empty primary search uses the free reserve once and reports fallback', async () => {
  for (const primary of [() => new Response(null, { status: 503 }), () => Response.json({ results: [], unresponsive_engines: [['google', 'CAPTCHA']] }), () => Response.json({ results: [] }), () => Response.json({ results: null })]) {
    const calls = [], events = [];
    const results = await searchWeb('product', 'IN', config, { onSearch: event => events.push(event), fetchImpl: async (url, request) => {
      calls.push(String(url));
      if (calls.length === 1) return primary();
      assert.equal(request.headers.authorization, `Bearer ${config.searchKey}`);
      assert.equal(JSON.parse(request.body).auto_parameters, false);
      assert.equal(JSON.parse(request.body).search_depth, 'basic');
      return Response.json({ results: [row] });
    } });
    assert.equal(results.length, 1);
    assert.deepEqual(calls, ['http://product-search:8080/search', 'https://api.tavily.com/search']);
    assert.deepEqual(events, [{ provider: 'Tavily', partial: false, fallback: true }]);
  }
});

test('partial primary results remain usable but engine failures are disclosed', async () => {
  const events = [];
  let calls = 0;
  await searchWeb('product', 'US', config, { onSearch: event => events.push(event), fetchImpl: async () => {
    calls++; return Response.json({ results: [row], unresponsive_engines: [['bing', 'timeout']] });
  } });
  assert.equal(calls, 1); assert.equal(events[0].partial, true);
});

test('cancellation never spends backup credits', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(searchWeb('product', 'IN', config, { signal: controller.signal, fetchImpl: async () => {
    calls++; controller.abort(); throw new Error('cancelled request');
  } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('both providers unavailable fails visibly with no paid provider or repeated attempt', async () => {
  let calls = 0;
  await assert.rejects(searchWeb('product', 'IN', config, { fetchImpl: async () => {
    calls++; return new Response(null, { status: calls === 1 ? 503 : 429 });
  } }), /HTTP 429/);
  assert.equal(calls, 2);
  await assert.rejects(searchWeb('product', 'IN', { ...config, searchKey: '' }, { fetchImpl: async () => Response.json({ results: [], unresponsive_engines: [['google', 'CAPTCHA']] }) }), /unavailable/);
  assert.deepEqual(await searchWeb('product', 'IN', { ...config, searchKey: '' }, { fetchImpl: async () => Response.json({ results: [] }) }), []);
});

test('search configuration rejects credentials, arbitrary insecure origins and URL parameters', () => {
  for (const SEARXNG_URL of ['http://untrusted.example', 'https://user:password@search.example', 'https://search.example/?key=secret', 'https://search.example/#hash', 'https://search.example/nested']) {
    assert.throws(() => providerConfig({ SEARXNG_URL }), /SEARXNG_URL/);
  }
});
