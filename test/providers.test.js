import test from 'node:test';
import assert from 'node:assert/strict';
import { providerConfig, reasonAboutProducts } from '../web/research/providers.js';

test('reasoning rejects unsafe model endpoints before transmitting credentials', async () => {
  let calls = 0;
  for (const baseUrl of ['invalid', 'http://provider.example/v1', 'https://user:secret@provider.example/v1', 'https://provider.example/v1?key=secret', 'https://provider.example/v1#secret']) {
    await assert.rejects(reasonAboutProducts({}, { baseUrl, apiKey: 'fixture-key', model: 'fixture' }, {
      fetchImpl: async () => { calls++; throw new Error('Must not send'); },
    }), /valid model base URL|HTTPS/);
  }
  assert.equal(calls, 0);
});

test('local reasoning accepts loopback HTTP without sending an empty credential', async () => {
  const config = providerConfig({ RESEARCH_MODEL_BASE_URL: 'http://localhost:11434/v1', RESEARCH_MODEL: 'fixture' });
  assert.equal(config.modelReady, true);
  const result = await reasonAboutProducts({}, config, { fetchImpl: async (url, request) => {
    assert.equal(url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(request.headers.authorization, undefined);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
  } });
  assert.deepEqual(result, {});
});
