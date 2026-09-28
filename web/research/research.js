import { fetchListing, publicUrl } from '../fetch-page.js';
import { inspectHtml } from '../analyze.js';
import { providerConfig, providerStatus, searchWeb, reasonAboutProducts, discoverCandidates } from './providers.js';
import { setTimeout as delay } from 'node:timers/promises';
import { numbersIn } from '../../extension/lib/text.js';

const MARKETS = { IN: { name: 'India', currency: 'INR', stores: ['amazon.in', 'flipkart.com', 'croma.com'] }, US: { name: 'United States', currency: 'USD', stores: ['amazon.com', 'walmart.com', 'bestbuy.com'] }, GB: { name: 'United Kingdom', currency: 'GBP', stores: ['amazon.co.uk', 'currys.co.uk', 'johnlewis.com'] } };
const RETAILERS = Object.values(MARKETS).flatMap(m => m.stores).concat(['reliancedigital.in', 'target.com', 'newegg.com']);
const REVIEWERS = ['rtings.com', 'notebookcheck.net', 'consumerreports.org', 'which.co.uk', 'nytimes.com', 'gsmarena.com', 'tomshardware.com'];
const clean = (value, max = 600) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const fail = message => Object.assign(new Error(message), { status: 400 });
const host = url => new URL(url).hostname.replace(/^www\./, '');
const domainMatches = (domain, list) => list.some(item => domain === item || domain.endsWith(`.${item}`));

export function validateBrief(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw fail('Enter a product listing URL.');
  for (const [key, limit] of [['url', 2000], ['needs', 2000], ['productHint', 180]]) {
    if (payload[key] !== undefined && (typeof payload[key] !== 'string' || payload[key].length > limit)) throw fail(`${key} must be text under ${limit} characters.`);
  }
  if (!payload.url?.trim()) throw fail('Enter a product listing URL.');
  const market = payload.market ?? 'IN';
  if (!Object.hasOwn(MARKETS, market)) throw fail('Choose a supported market.');
  const budget = payload.budget === '' || payload.budget == null ? null : payload.budget;
  if (budget !== null && (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0 || budget > 100000000)) throw fail('Budget must be a positive amount, or left blank.');
  let url;
  try { url = new URL(payload.url.trim()); } catch { throw fail('Enter a valid product listing URL.'); }
  for (const key of [...url.searchParams.keys()]) if (/token|secret|key|auth|session|email|password|signature/i.test(key)) throw fail('Remove credentials or private session parameters from the product URL.');
  url.hash = '';
  return { url: url.href, needs: clean(payload.needs, 2000), productHint: clean(payload.productHint, 180), market, currency: MARKETS[market].currency, budget };
}

export function listingTrust(report) {
  if (!report || (!report.specs.length && report.verdict.headline === 'This page is not a listing')) return { score: null, coverage: 0, components: [], label: 'Not enough listing evidence' };
  const measured = Math.min(1, report.specs.length / 5);
  const terms = [report.seller.name, report.seller.warranty, report.seller.returns].filter(Boolean).length / 3;
  const reviews = report.reviews.sampleSize >= 4 ? 1 : report.reviews.histogram.length ? 0.5 : 0;
  const checks = [
    { label: 'Comparable specifications', weight: 35, observed: measured, risk: (report.verdict.breakdown.find(r => r.id === 'copy')?.points || 0) / 40 },
    { label: 'Seller and purchase terms', weight: 25, observed: terms, risk: report.seller.risk },
    { label: 'Review evidence', weight: 20, observed: reviews, risk: report.reviews.risk },
    { label: 'Consistency and completeness', weight: 20, observed: measured, risk: (report.verdict.breakdown.find(r => r.id === 'slippery')?.points || 0) / 15 },
  ];
  const components = checks.map(row => ({ label: row.label, max: row.weight, points: Math.round(row.weight * row.observed * (1 - row.risk)), available: Math.round(row.observed * 100) }));
  const coverage = Math.round(checks.reduce((sum, row) => sum + row.weight * row.observed, 0));
  const enough = coverage >= 40;
  return { score: enough ? components.reduce((sum, row) => sum + row.points, 0) : null, coverage, components, label: enough ? 'Provisional listing trust' : 'Not enough listing evidence' };
}

function sourceKind(url) {
  const domain = host(url);
  return domainMatches(domain, RETAILERS) ? 'retailer' : domainMatches(domain, REVIEWERS) ? 'review publication' : 'other source';
}

export function researchQueries(brief, title, category) {
  const market = MARKETS[brief.market];
  const subject = clean(brief.productHint || title || brief.url, 180);
  const need = clean(brief.needs, 180);
  const budget = brief.budget === null ? '' : `under ${brief.budget} ${brief.currency}`;
  const type = category && category !== 'general' ? category : subject;
  return [...new Set([
    `${subject} manufacturer official specifications warranty ${market.name}`,
    `${subject} independent review measured test durability problems`,
    `${subject} price ${market.stores.slice(0, 2).map(s => `site:${s}`).join(' OR ')}`,
    `${type} alternatives ${need} ${budget} ${market.name}`,
    `${type} ${need} ${budget} site:${market.stores[2]}`,
  ])];
}

function citations(value, sources) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap(item => {
    const source = sources.find(row => row.id === item?.sourceId && row.status === 'read');
    const quote = clean(item?.quote, 500);
    if (!source || quote.length < 20 || !clean(source.text, 20000).includes(quote)) return [];
    return [{ sourceId: source.id, quote }];
  });
}

function numbersSupported(text, evidence, brief) {
  const normalize = value => String(value ?? '').replace(/(?<=\d),(?=\d)/g, '');
  const allowed = new Set(numbersIn(normalize(`${evidence.map(item => item.quote).join(' ')} ${brief.needs} ${brief.budget ?? ''}`)));
  return numbersIn(normalize(text)).every(number => allowed.has(number));
}

export function groundAnalysis(raw, sources, brief) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.fit) || !Array.isArray(raw.findings) || !Array.isArray(raw.alternatives)) throw new Error('Reasoning response had an invalid report structure.');
  let dropped = 0;
  const fit = raw.fit.slice(0, 6).flatMap(row => {
    if (!row || !['meets', 'misses', 'unclear'].includes(row.assessment) || !clean(row.requirement) || !clean(row.reason)) { dropped++; return []; }
    const evidence = citations(row.evidence, sources);
    if ((row.assessment !== 'unclear' && (!evidence.length || !brief.needs)) || !numbersSupported(row.reason, evidence, brief)) { dropped++; return []; }
    return [{ requirement: clean(row.requirement, 180), assessment: row.assessment, reason: clean(row.reason), evidence }];
  });
  const findings = raw.findings.slice(0, 5).flatMap(row => {
    const evidence = citations(row?.evidence, sources);
    if (!evidence.length || !clean(row?.title) || !clean(row?.detail) || !numbersSupported(`${row.title} ${row.detail}`, evidence, brief)) { dropped++; return []; }
    return [{ title: clean(row.title, 180), detail: clean(row.detail), evidence }];
  });
  const alternatives = raw.alternatives.slice(0, 3).flatMap(row => {
    const evidence = citations(row?.evidence, sources);
    const cited = evidence.map(c => sources.find(s => s.id === c.sourceId));
    const name = clean(row?.name, 180);
    if (!name || !clean(row?.why) || !clean(row?.tradeoff) || new Set(cited.map(s => host(s.url))).size < 2 || !cited.some(s => s.kind === 'retailer') || !evidence.some(c => c.quote.toLowerCase().includes(name.toLowerCase())) || !numbersSupported(`${row.why} ${row.tradeoff}`, evidence, brief)) { dropped++; return []; }
    return [{ name, why: clean(row.why), tradeoff: clean(row.tradeoff), evidence }];
  });
  return { questions: Array.isArray(raw.questions) ? raw.questions.filter(q => typeof q === 'string').slice(0, 3).map(q => clean(q, 240)) : [], fit, findings, alternatives, dropped };
}

export function groundedCandidates(raw, sources, selectedTitle = '') {
  if (!Array.isArray(raw?.candidates)) throw new Error('Invalid candidate discovery response.');
  const seen = new Set();
  return raw.candidates.slice(0, 2).flatMap(row => {
    const source = sources.find(s => s.id === row?.sourceId);
    const name = clean(row?.name, 120);
    const quote = clean(row?.quote, 500);
    if (!source || name.length < 4 || quote.length < 20 || !quote.toLowerCase().includes(name.toLowerCase()) || !clean(`${source.text || ''} ${source.snippet || ''}`, 22000).includes(quote) || selectedTitle.toLowerCase().includes(name.toLowerCase()) || seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    return [name];
  });
}

export async function researchProduct(payload, options = {}) {
  const brief = validateBrief(payload);
  const config = options.config || providerConfig();
  const validateUrl = options.validateUrl || publicUrl;
  brief.url = (await validateUrl(brief.url)).href;
  const fetchPage = options.fetchPage || fetchListing;
  const search = options.search || searchWeb;
  const reason = options.reason || reasonAboutProducts;
  const discover = options.discover || discoverCandidates;
  const signal = options.signal || AbortSignal.timeout(180000);
  const onProgress = options.onProgress || (() => {});
  const result = { version: 1, mode: 'live', checkedAt: new Date().toISOString(), brief, report: null, trust: listingTrust(null), sources: [], queries: [], warnings: [], analysis: null, providers: providerStatus(config) };
  onProgress('Reading the selected listing');
  try {
    const page = await fetchPage(brief.url, { signal });
    const inspected = inspectHtml(page.html, page.finalUrl);
    result.report = inspected.report;
    result.sources.push({ id: 's1', url: page.finalUrl, title: inspected.report.product.title, kind: 'selected listing', status: 'read', text: inspected.text, retrievedAt: result.checkedAt });
    result.trust = listingTrust(result.report);
    if (result.trust.score === null) result.warnings.push('Not enough product evidence to score. Add the exact product name and variant.');
  } catch (error) {
    if (error.status === 400) throw error;
    result.warnings.push('The store page could not be read. Price and seller terms are unverified.');
    result.sources.push({ id: 's1', url: brief.url, title: brief.productHint || 'Selected listing', kind: 'selected listing', status: 'unavailable', text: '', retrievedAt: result.checkedAt });
  }
  if (!providerStatus(config).searchConfigured) {
    result.warnings.push('Other stores and independent reviews were not searched. Search is not configured.');
    await interpret();
    return finish(result);
  }
  onProgress('Searching retailers, manufacturer information and independent reviews');
  result.queries = researchQueries(brief, result.report?.product.title, result.report?.category);
  const candidates = [];
  let lastSearch = 0;
  const runSearch = async query => {
    const wait = options.search ? 0 : Math.max(0, 1100 - (Date.now() - lastSearch));
    if (wait) await delay(wait, undefined, { signal });
    lastSearch = Date.now();
    return search(query, brief.market, config, { signal, onSearch: ({ provider, partial, fallback }) => {
      result.searchProviders ||= [];
      if (!result.searchProviders.includes(provider)) result.searchProviders.push(provider);
      for (const warning of [partial && 'Some search engines were unavailable. Source discovery may be incomplete.', fallback && 'Backup search was used because primary search was unavailable or returned no results.']) {
        if (warning && !result.warnings.includes(warning)) result.warnings.push(warning);
      }
    } });
  };
  for (const query of result.queries) {
    if (signal.aborted) break;
    try { candidates.push(...await runSearch(query)); }
    catch { result.warnings.push(`Search failed for: ${query}`); }
  }
  const seen = new Set(result.sources.map(s => s.url));
  const unique = candidates.filter(row => {
    if (seen.has(row.url)) return false;
    seen.add(row.url); return true;
  });
  const ordered = [];
  const groups = new Map();
  for (const row of unique) {
    try { const domain = host(row.url); const group = groups.get(domain) || []; group.push(row); groups.set(domain, group); } catch {}
  }
  while (ordered.length < 10 && [...groups.values()].some(g => g.length)) {
    for (const group of groups.values()) if (group.length && ordered.length < 10) ordered.push(group.shift());
  }
  onProgress('Opening sources and checking what can actually be read');
  let nextSourceId = 2;
  const readSources = async rows => {
    for (let index = 0; index < rows.length && !signal.aborted; index += 3) {
      const batch = await Promise.all(rows.slice(index, index + 3).map(async row => {
        const id = `s${nextSourceId++}`;
        try {
          const safe = await validateUrl(row.url);
          const source = { id, url: safe.href, title: clean(row.title, 240), kind: sourceKind(safe.href), status: 'search only', snippet: clean(row.snippet, 1200), text: '', retrievedAt: new Date().toISOString() };
          try {
            const page = await fetchPage(source.url, { signal });
            source.url = page.finalUrl;
            source.kind = sourceKind(page.finalUrl);
            source.text = inspectHtml(page.html, page.finalUrl).text;
            source.status = source.text.length >= 100 ? 'read' : 'search only';
          } catch {}
          return source;
        } catch { return null; }
      }));
      for (const source of batch) if (source && !result.sources.some(s => s.url === source.url)) result.sources.push(source);
    }
  };
  await readSources(ordered);
  if (config.modelReady && !signal.aborted && result.sources.some(s => s.id !== 's1')) {
    onProgress('Identifying alternatives to investigate from the discovered sources');
    try {
      const raw = await discover({ brief, selectedProduct: result.report?.product.title, sources: result.sources }, config, { signal });
      const names = groundedCandidates(raw, result.sources, result.report?.product.title || brief.productHint);
      if (names.length) onProgress('Checking candidate products by name across stores and review sources');
      const followups = [];
      for (const name of names) {
        for (const query of [`${name} ${MARKETS[brief.market].name} price ${MARKETS[brief.market].stores.map(s => `site:${s}`).join(' OR ')}`, `${name} independent measured review manufacturer specifications`]) {
          result.queries.push(query);
          try {
            for (const row of await runSearch(query)) if (!seen.has(row.url)) { seen.add(row.url); followups.push(row); }
          } catch { result.warnings.push(`Candidate search failed for: ${query}`); }
        }
      }
      await readSources(followups.slice(0, 8));
    } catch { result.warnings.push('Alternative discovery failed. Comparison is incomplete.'); }
  }
  if (signal.aborted) result.warnings.push('Time limit reached. Results are incomplete.');
  if (!result.sources.some(s => s.id !== 's1' && s.status === 'read')) result.warnings.push('No additional pages could be read. Search snippets were excluded from the evidence.');
  await interpret();
  return finish(result);

  async function interpret() {
    if (config.modelReady && !signal.aborted && result.sources.some(s => s.status === 'read')) {
      onProgress('Comparing your needs and candidate products against source evidence');
      try {
        const raw = await reason({ brief, listing: result.report, sources: result.sources }, config, { signal });
        result.analysis = groundAnalysis(raw, result.sources, brief);
        if (result.analysis.dropped) result.warnings.push(`${result.analysis.dropped} unsupported AI claims were removed.`);
      } catch { result.warnings.push('AI comparison failed. The listing checks below are still available.'); }
    } else if (!config.modelReady) result.warnings.push('AI comparison is not configured. Only listing rules were checked.');
  }
}

function finish(result) {
  result.coverage = { pagesRead: result.sources.filter(s => s.status === 'read').length, domainsRead: new Set(result.sources.filter(s => s.status === 'read').map(s => host(s.url))).size, discovered: result.sources.length };
  result.sources = result.sources.map(({ text, ...source }) => source);
  return result;
}
