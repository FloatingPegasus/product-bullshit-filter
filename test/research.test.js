import { sampleResearch } from '../support/research-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateBrief, listingTrust, groundAnalysis, researchProduct, researchQueries, groundedCandidates } from '../web/research/research.js';
import { searchWeb, reasonAboutProducts, providerStatus, providerConfig } from '../web/research/providers.js';
import { buildReport } from '../web/listing/report.js';
import { Window } from 'happy-dom';
import { renderResearch } from '../web/public/research-render.js';
const config = { searchKey: 'secret-search-key', modelReady: true, model: 'fixture-model', apiKey: 'secret-model-key', baseUrl: 'https://provider.example/v1' };
const brief = { url: 'https://shop.example/product', needs: 'USB-C charging for my laptop', market: 'IN', budget: 3000 };
const html = await readFile(new URL('./fixtures/amazon-page.html', import.meta.url), 'utf8');
const validateUrl = async url => { if (url.includes('127.0.0.1')) throw Object.assign(new Error('not public'), { status: 400 }); return new URL(url); };
const noClaims = { understanding: 'Laptop charging', questions: [], fit: [], findings: [], alternatives: [] };

test('research brief rejects malformed constraints and credential URLs without turning missing budget into zero', () => {
  assert.equal(validateBrief({ ...brief, budget: '' }).budget, null);
  for (const budget of [0, -1, '3000', NaN, {}, Infinity]) assert.throws(() => validateBrief({ ...brief, budget }));
  assert.throws(() => validateBrief({ ...brief, market: 'elsewhere' }));
  assert.throws(() => validateBrief({ ...brief, needs: [] }));
  assert.throws(() => validateBrief({ ...brief, url: 'https://shop.example/?session=private' }));
  assert.ok(researchQueries(validateBrief(brief), 'Laptop charger', 'power').some(q => q.includes('3000 INR')));
});

test('trust is unknown for empty pages and does not reward missing seller/review evidence', () => {
  assert.equal(listingTrust(buildReport({ title: 'Access denied' })).score, null);
  const report = buildReport({ title: 'Power bank', specs: [{ name: 'Output', value: '65 W USB-C PD' }] });
  const trust = listingTrust(report);
  assert.equal(trust.components.find(row => row.label === 'Review evidence').points, 0);
  assert.equal(trust.components.find(row => row.label === 'Seller and purchase terms').points, 0);
  assert.ok(trust.coverage < 40);
  assert.equal(trust.score, null);
  assert.deepEqual(listingTrust(report), trust);
});

test('grounding withholds invented citations and single-domain alternatives', () => {
  const sources = [
    { id: 's1', status: 'read', url: 'https://amazon.in/p', kind: 'retailer', text: 'Atlas Charger delivers 65 W USB-C output. Listed at INR 2499 with a one year warranty.' },
    { id: 's2', status: 'read', url: 'https://rtings.com/test', kind: 'review publication', text: 'Atlas Charger sustained output at full load. It is heavier than the comparison device.' },
    { id: 's3', status: 'search only', url: 'https://other.example', kind: 'other source', text: 'Atlas Charger is the very best in all of our tests.' },
  ];
  const evidence = [{ sourceId: 's1', quote: 'Atlas Charger delivers 65 W USB-C output.' }, { sourceId: 's2', quote: 'Atlas Charger sustained output at full load.' }];
  const raw = { ...noClaims, trust: 100, fit: [{ requirement: 'Laptop charging', assessment: 'meets', reason: 'Supports USB-C output.', evidence }], findings: [{ title: 'Invented', detail: 'Anything', evidence: [{ sourceId: 's3', quote: sources[2].text }] }], alternatives: [{ name: 'Atlas Charger', why: 'Sustained output', tradeoff: 'Heavier', evidence }] };
  const grounded = groundAnalysis(raw, sources, brief);
  assert.equal(grounded.fit.length, 1); assert.equal(grounded.findings.length, 0); assert.equal(grounded.alternatives.length, 1); assert.equal(grounded.trust, undefined);
  assert.equal(groundAnalysis({ ...raw, alternatives: [{ ...raw.alternatives[0], evidence: [evidence[0]] }] }, sources, brief).alternatives.length, 0);
  assert.equal(groundAnalysis(raw, sources, { ...brief, needs: '' }).fit.length, 0);
  assert.throws(() => groundAnalysis({}, sources, brief));
});

test('unconfigured research produces local evidence without pretending a search ran', async () => {
  const result = await researchProduct(brief, { config: {}, validateUrl, fetchPage: async url => ({ html, finalUrl: url }), search: () => { throw new Error('Must not search'); } });
  assert.equal(result.analysis, null); assert.equal(result.queries.length, 0);
  assert.match(result.warnings.join(' '), /not configured/);
  assert.equal(result.sources[0].text, undefined);
  await assert.rejects(researchProduct({ ...brief, url: 'http://127.0.0.1' }, { config: {}, validateUrl }), /not public/);
});

test('blocked selected page can research other domains without assigning trust to the inaccessible listing', async () => {
  const progress = [];
  const result = await researchProduct(brief, { config, validateUrl, discover: async () => ({ candidates: [] }), onProgress: step => progress.push(step),
    fetchPage: async url => { if (url.includes('shop.example')) throw new Error('Blocked'); return { html, finalUrl: url }; },
    search: async () => [{ url: 'https://amazon.in/p', title: 'Product source' }, { url: 'http://127.0.0.1/admin', title: 'Unsafe' }],
    reason: async () => ({ ...noClaims, score: 100 }),
  });
  assert.equal(result.report, null); assert.equal(result.trust.score, null); assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].status, 'unavailable'); assert.ok(progress.length >= 4);
  assert.equal(result.analysis.score, undefined);
  assert.equal(JSON.stringify(result).includes(config.searchKey), false);
});

test('provider failures preserve useful evidence and withhold a recommendation', async () => {
  const result = await researchProduct(brief, { config, validateUrl, fetchPage: async url => ({ html, finalUrl: url }), search: async () => { throw new Error('secret provider error'); }, reason: async () => { throw new Error('secret model key'); } });
  assert.ok(result.report); assert.equal(result.analysis, null); assert.match(result.warnings.join(' '), /AI comparison failed/i);
  assert.equal(JSON.stringify(result).includes('secret model key'), false);
});

test('search and model adapters send credentials only in headers, validate envelopes, and refuse redirects', async () => {
  let request;
  const fetchImpl = async (url, init) => { request = { url: String(url), ...init }; return Response.json({ results: [{ url: 'https://example.com/p', title: 'Example', content: '<b>Page</b>' }] }); };
  const results = await searchWeb('power bank', 'IN', config, { fetchImpl });
  assert.equal(results[0].snippet, 'Page'); assert.equal(request.redirect, 'error'); assert.equal(request.url, 'https://api.tavily.com/search');
  const searchBody = JSON.parse(request.body);
  assert.equal(searchBody.country, 'india'); assert.equal(searchBody.search_depth, 'basic'); assert.equal(searchBody.auto_parameters, false);
  assert.equal(searchBody.include_answer, false); assert.equal(searchBody.include_raw_content, false);
  assert.equal(request.headers.authorization, `Bearer ${config.searchKey}`); assert.equal(request.url.includes(config.searchKey), false); assert.equal(request.body.includes(config.searchKey), false);
  const model = await reasonAboutProducts({ brief }, config, { fetchImpl: async (url, init) => { request = init; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(noClaims) } }] }); } });
  assert.deepEqual(model, noClaims); assert.equal(request.body.includes(config.apiKey), false); assert.equal(request.redirect, 'error');
  for (const data of [{}, { results: null }, { results: [null] }, { results: [{ url: 'https://example.com', title: 'Test', content: 42 }] }]) await assert.rejects(searchWeb('test', 'IN', config, { fetchImpl: async () => Response.json(data) }), /invalid result/);
  assert.deepEqual(await searchWeb('test', 'IN', config, { fetchImpl: async () => Response.json({ results: [] }) }), []);
  let quotaCalls = 0;
  await assert.rejects(searchWeb('test', 'IN', config, { fetchImpl: async () => { quotaCalls++; return Response.json({ error: 'private details' }, { status: 429 }); } }), /HTTP 429/);
  assert.equal(quotaCalls, 1);
  assert.equal(providerConfig({ TAVILY_API_KEY: 'free-tier-fixture' }).searchKey, 'free-tier-fixture');
  await assert.rejects(reasonAboutProducts({}, config, { fetchImpl: async () => Response.json({ error: { message: 'secret-key' } }, { status: 401 }) }), error => !error.message.includes('secret-key'));
  assert.equal(JSON.stringify(providerStatus(config)).includes(config.apiKey), false);
  assert.equal(providerConfig({ RESEARCH_MODEL: 'local', RESEARCH_MODEL_BASE_URL: 'http://127.0.0.1:11434/v1' }).modelReady, true);
});

test('research renderer labels demos, renders hostile text inertly, and replaces old product results', async () => {
  const window = new Window(); const previous = globalThis.document; globalThis.document = window.document;
  try {
    const mount = document.createElement('div'); const demo = await sampleResearch('power-bank');
    demo.report.product.title = '<img src=x onerror=alert(1)>';
    demo.sources[0].url = 'javascript:alert(1)';
    renderResearch(mount, demo);
    assert.match(mount.textContent, /SYNTHETIC EXAMPLE/); assert.match(mount.textContent, /No live|No stores|No product|No/);
    assert.equal(mount.querySelector('script,img,a[href^="javascript:"]'), null);
    assert.ok(mount.textContent.includes('<img src=x onerror=alert(1)>'));
    renderResearch(mount, await sampleResearch('earbuds'));
    assert.equal(mount.textContent.includes('<img src=x'), false);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; window.close(); }
});

test('candidate discovery must quote an actual discovered name, then triggers targeted verification searches', async () => {
  const discoveryText = 'Atlas Charger is an alternative with 65 W USB-C output and a compact enclosure for laptop charging.';
  assert.deepEqual(groundedCandidates({ candidates: [{ name: 'Invented Charger', sourceId: 's2', quote: discoveryText }] }, [{ id: 's2', text: discoveryText }]), []);
  const queries = [];
  const result = await researchProduct(brief, {
    config, validateUrl,
    fetchPage: async url => ({ html: url.includes('shop.example') ? html : `<html><body><h1>Atlas Charger</h1><p>${discoveryText}</p><p>Measured under sustained load. Warranty and availability depend on the retailer.</p></body></html>`, finalUrl: url }),
    search: async query => { queries.push(query); return query.startsWith('Atlas Charger') ? [{ title: 'Retail listing', url: 'https://amazon.in/atlas' }, { title: 'Review', url: 'https://rtings.com/atlas' }] : [{ title: 'Discovery', url: 'https://reviews.example/roundup', snippet: discoveryText }]; },
    discover: async () => ({ candidates: [{ name: 'Atlas Charger', sourceId: 's2', quote: discoveryText }] }),
    reason: async ({ sources }) => ({ ...noClaims, alternatives: [{ name: 'Atlas Charger', why: 'Laptop charging output', tradeoff: 'Availability needs checking', evidence: sources.filter(s => s.url.includes('/atlas')).map(s => ({ sourceId: s.id, quote: discoveryText })) }] }),
  });
  assert.equal(queries.filter(q => q.startsWith('Atlas Charger')).length, 2);
  assert.equal(result.analysis.alternatives.length, 1);
  assert.equal(result.coverage.domainsRead, 4);
  assert.equal(result.sources.every(s => !('text' in s)), true);
});

test('gateway configuration uses a dedicated app key and its supported output-token parameter', async () => {
  const gateway = providerConfig({ OPENAI_API_KEY: 'dedicated-fixture-key' });
  assert.equal(gateway.baseUrl, 'https://ai.kanishq.dev/v1');
  assert.equal(gateway.model, 'standard'); assert.equal(gateway.modelReady, true);
  assert.equal(providerConfig({}).modelReady, false);
  const override = providerConfig({ OPENAI_API_KEY: 'unused-key', RESEARCH_MODEL_KEY: 'override-key', RESEARCH_MODEL_BASE_URL: 'https://provider.example/v1', RESEARCH_MODEL: 'selected' });
  assert.equal(override.apiKey, 'override-key'); assert.equal(override.model, 'selected');
  await reasonAboutProducts({ brief }, gateway, { fetchImpl: async (url, request) => {
    assert.equal(url, 'https://ai.kanishq.dev/v1/chat/completions');
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'standard'); assert.equal(body.max_tokens, 4500);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(request.body.includes('dedicated-fixture-key'), false);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(noClaims) } }] });
  } });
  for (const finish_reason of ['length', 'content_filter', null]) await assert.rejects(reasonAboutProducts({}, gateway, { fetchImpl: async () => Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify(noClaims) } }] }) }));
});

test('AI can assess listing evidence without a search key while keeping cross-store research explicitly absent', async () => {
  let called = false;
  const result = await researchProduct(brief, {
    config: { ...config, searchKey: '' }, validateUrl,
    fetchPage: async url => ({ html, finalUrl: url }),
    reason: async ({ sources }) => { called = true; assert.equal(sources.length, 1); return noClaims; },
    search: () => { throw new Error('Search must not run'); },
  });
  assert.equal(called, true); assert.ok(result.analysis);
  assert.equal(result.queries.length, 0);
  assert.match(result.warnings.join(' '), /were not searched/);
  assert.deepEqual(result.trust, listingTrust(result.report));
});

test('research uses keyless search and preserves primary, fallback and partial-search provenance', async () => {
  let calls = 0;
  const result = await researchProduct(brief, {
    config: { searchBaseUrl: 'http://product-search:8080', searchKey: '', modelReady: false }, validateUrl,
    fetchPage: async url => ({ html, finalUrl: url }),
    search: async (_, __, ___, { onSearch }) => {
      calls++;
      onSearch(calls === 1 ? { provider: 'Tavily', fallback: true } : { provider: 'SearXNG', partial: true });
      return [{ url: 'https://amazon.in/product', title: 'Fixture' }];
    },
  });
  assert.equal(calls, 5); assert.equal(result.providers.searchConfigured, true);
  assert.deepEqual(result.searchProviders, ['Tavily', 'SearXNG']);
  assert.equal(result.warnings.filter(w => w.includes('Some search engines')).length, 1);
  assert.equal(result.warnings.filter(w => w.includes('Backup search')).length, 1);
});

test('matching a source excerpt cannot smuggle invented numerical claims into the report', () => {
  const sources = [{ id: 's1', status: 'read', url: 'https://shop.example/p', text: 'Measured continuous output is 65 W over USB-C.' }];
  const evidence = [{ sourceId: 's1', quote: sources[0].text }];
  const result = groundAnalysis({ ...noClaims, findings: [
    { title: 'Output', detail: 'It delivers 65 W.', evidence },
    { title: 'Made-up price', detail: 'The best deal costs INR 1999.', evidence },
    { title: 'Made-up performance', detail: 'It delivers 100 W.', evidence },
  ] }, sources, brief);
  assert.equal(result.findings.length, 1); assert.equal(result.dropped, 2);
});
