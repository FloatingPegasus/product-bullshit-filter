import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { buildReport } from '../extension/lib/report.js';
import { renderReport } from '../extension/sidepanel/render.js';

test('reports render untrusted listing strings as text and replace earlier results', () => {
  const window = new Window();
  const previous = {document:globalThis.document, Node:globalThis.Node};
  globalThis.document=window.document; globalThis.Node=window.Node;
  try {
    const mount=document.createElement('div');
    const title='<img src=x onerror=alert(1)>';
    renderReport(mount,buildReport({title,bullets:['<script>bad()</script>'],url:'javascript:alert(1)'}));
    assert.match(mount.textContent,/<img src=x onerror=alert\(1\)>/);
    assert.equal(mount.querySelector('img,script'),null);
    assert.equal(mount.querySelector('a[href^="javascript:"]'),null);
    renderReport(mount,buildReport({title:'Replacement listing',bullets:[]}));
    assert.equal(mount.querySelectorAll('article').length,1);
    assert.equal(mount.textContent.includes(title),false);
  } finally {
    if(previous.document===undefined) delete globalThis.document; else globalThis.document=previous.document;
    if(previous.Node===undefined) delete globalThis.Node; else globalThis.Node=previous.Node;
    window.close();
  }
});
