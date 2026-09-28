import { readFile } from 'node:fs/promises';
import { buildReport } from '../web/listing/report.js';
import { listingTrust } from '../web/research/research.js';

export async function sampleResearch(name) {
  if (!['earbuds', 'power-bank'].includes(name)) throw new Error('Unknown fixture');
  const scrape = JSON.parse(await readFile(new URL(`../test/fixtures/${name}.json`, import.meta.url), 'utf8'));
  const report = buildReport(scrape);
  return {
    version: 1, mode: 'demo', checkedAt: new Date().toISOString(),
    brief: { url: report.product.url, needs: '', market: 'IN', currency: 'INR', budget: null, productHint: '' },
    report, trust: listingTrust(report), analysis: null, queries: [], warnings: [],
    sources: [{ id: 's1', url: report.product.url, title: report.product.title, kind: 'synthetic fixture', status: 'demo' }],
    coverage: { pagesRead: 0, domainsRead: 0, discovered: 1 },
    providers: { searchConfigured: false, reasoningConfigured: false },
  };
}
