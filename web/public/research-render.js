function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function section(title) {
  const element = node('section', null, 'report-section');
  element.append(node('h3', title));
  return element;
}
function safeLink(url, text) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return node('span', text);
    const link = node('a', text);
    link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  } catch { return node('span', text); }
}
function evidenceList(items, sources) {
  const details = node('details', null, 'evidence');
  details.append(node('summary', 'Supporting excerpts'));
  for (const item of items) {
    const source = sources.find(s => s.id === item.sourceId);
    const quote = node('blockquote', item.quote);
    if (source) quote.append(node('br'), safeLink(source.url, `${source.id.toUpperCase()} · ${source.title}`));
    details.append(quote);
  }
  return details;
}
function facts(rows) {
  const list = node('dl', null, 'facts');
  for (const [label, value] of rows) list.append(node('dt', label), node('dd', value || 'Not found'));
  return list;
}

export function renderResearch(mount, result) {
  mount.replaceChildren();
  const { report, analysis, trust, sources, brief } = result;
  if (result.mode === 'demo') mount.append(node('p', 'SYNTHETIC EXAMPLE · No live research', 'notice'));
  const head = node('div', null, 'report-heading');
  const identity = node('div');
  identity.append(node('h2', report?.product.title || brief.productHint || 'Product not identified'));
  identity.append(node('p', [report?.product.variant, report?.product.price, brief.market].filter(Boolean).join(' · '), 'muted'));
  if (result.mode !== 'demo') identity.append(safeLink(brief.url, 'Original listing'));
  const score = node('div', null, 'score');
  score.append(node('span', 'Listing trust'), node('strong', trust.score == null ? 'Unknown' : `${trust.score}/100`));
  head.append(identity, score); mount.append(head);

  if (result.warnings.length) {
    const notice = node('ul', null, 'notice');
    for (const warning of result.warnings) notice.append(node('li', warning));
    mount.append(notice);
  }

  if (report?.gotchas.length) {
    const concerns = section('What to question');
    const add = (parent, row) => {
      const item = node('article', null, 'finding');
      item.append(node('h4', row.title), node('p', row.detail)); parent.append(item);
    };
    for (const row of report.gotchas.slice(0, 4)) add(concerns, row);
    if (report.gotchas.length > 4) {
      const more = node('details'); more.append(node('summary', `${report.gotchas.length - 4} more flags`));
      for (const row of report.gotchas.slice(4)) add(more, row);
      concerns.append(more);
    }
    mount.append(concerns);
  }

  if (analysis?.fit.length) {
    const fit = section('Fit for your needs');
    for (const row of analysis.fit) {
      const item = node('article', null, 'fit-row');
      item.append(node('span', { meets: 'Supported', misses: 'Mismatch', unclear: 'Unknown' }[row.assessment], `assessment ${row.assessment}`));
      const body = node('div'); body.append(node('h4', row.requirement), node('p', row.reason));
      if (row.evidence.length) body.append(evidenceList(row.evidence, sources));
      item.append(body); fit.append(item);
    }
    mount.append(fit);
  }
  if (analysis?.findings.length) {
    const findings = section('Source findings');
    for (const row of analysis.findings) {
      const item = node('article', null, 'finding');
      item.append(node('h4', row.title), node('p', row.detail), evidenceList(row.evidence, sources)); findings.append(item);
    }
    mount.append(findings);
  }
  if (analysis?.questions.length) {
    const questions = section('Still need to know');
    const list = node('ul'); for (const question of analysis.questions) list.append(node('li', question));
    questions.append(list); mount.append(questions);
  }
  if (analysis && result.queries.length) {
    const alternatives = section('Alternatives');
    for (const row of analysis.alternatives) {
      const item = node('article', null, 'alternative');
      item.append(node('h4', row.name), node('p', row.why), node('p', `Tradeoff: ${row.tradeoff}`), evidenceList(row.evidence, sources));
      alternatives.append(item);
    }
    if (!analysis.alternatives.length) alternatives.append(node('p', 'No better alternative established from the sources checked.', 'muted'));
    mount.append(alternatives);
  }

  if (report) {
    const listing = section('What the listing states');
    const columns = node('div', null, 'listing-columns');
    const specs = node('div'); specs.append(node('h4', 'Specifications'));
    specs.append(report.specs.length ? facts(report.specs.slice(0, 10).map(row => [row.name, row.value])) : node('p', 'No comparable specifications found.', 'muted'));
    const terms = node('div'); terms.append(node('h4', 'Seller & terms'));
    terms.append(facts([['Seller', report.seller.name], ['Warranty', report.seller.warranty], ['Returns', report.seller.returns]]));
    columns.append(specs, terms); listing.append(columns); mount.append(listing);
  }

  const method = node('details', null, 'score-method'); method.append(node('summary', 'Score breakdown'));
  method.append(node('p', `${trust.coverage}% of the weighted listing evidence was available. A score needs at least 40% coverage. Missing evidence earns no points. This score does not establish product quality.`, 'muted'));
  for (const row of trust.components) {
    const line = node('div', null, 'score-row'); line.append(node('span', row.label), node('strong', `${row.points} / ${row.max}`)); method.append(line);
  }
  if (report) method.append(node('p', report.reviews.note, 'muted'));
  mount.append(method);

  const trail = node('details', null, 'sources');
  trail.append(node('summary', `Sources · ${result.coverage.pagesRead} read / ${sources.length} found`));
  trail.append(node('p', `Checked ${new Date(result.checkedAt).toLocaleString()}.`, 'muted'));
  if (result.searchProviders?.length) trail.append(node('p', `Search sources: ${result.searchProviders.join(', ')}.`, 'muted'));
  for (const source of sources) {
    const item = node('article', null, 'source-row');
    item.append(node('span', source.id.toUpperCase(), 'source-id'));
    const body = node('div');
    body.append(result.mode === 'demo' ? node('strong', source.title) : safeLink(source.url, source.title));
    body.append(node('p', `${source.kind} · ${source.status === 'read' ? 'Page read' : source.status === 'demo' ? 'Synthetic data' : source.status === 'search only' ? 'Snippet only; not used as evidence' : 'Unavailable'}`, 'muted'));
    item.append(body); trail.append(item);
  }
  mount.append(trail);
}
