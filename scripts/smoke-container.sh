#!/usr/bin/env bash
set -euo pipefail
image=${1:?Pass the image to validate}
container="product-smoke-$$-$RANDOM"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --name "$container" --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --env PUBLIC_ORIGIN=https://product-ci.invalid "$image" >/dev/null
ready=0
for attempt in {1..30}; do
  if docker exec "$container" node -e 'require("node:http").get("http://127.0.0.1:8787/healthz", {headers:{host:"product-ci.invalid"},timeout:5000},r=>process.exit(r.statusCode===200?0:1)).on("timeout",function(){this.destroy();}).on("error",()=>process.exit(1))'; then
    ready=1
    break
  fi
  sleep 1
done
if [[ $ready != 1 ]]; then
  docker logs "$container" >&2
  exit 1
fi
docker exec -i "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import http from 'node:http';
const base = 'http://127.0.0.1:8787';
const headers = { host: 'product-ci.invalid' };
const request = (path, { method = 'GET', headers: extraHeaders = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request(`${base}${path}`, { method, headers: { ...headers, ...extraHeaders }, timeout: 5000 }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
  });
  req.on('error', reject);
  req.on('timeout', () => req.destroy(new Error('Smoke request timed out')));
  req.end(body);
});
const home = await request('/');
assert.equal(home.status, 200);
assert.match(await home.text(), /Product link/);
const config = await (await request('/api/config')).json();
assert.deepEqual(config, { ok: true, searchConfigured: false, reasoningConfigured: false });
for (const url of ['/research-render.js', '/app.js', '/site.css']) {
  assert.equal((await request(url)).status, 200);
}
const blocked = await request('/api/research', {
  method: 'POST', headers: { ...headers, 'content-type': 'application/json', origin: 'https://product-ci.invalid' },
  body: JSON.stringify({ url: 'http://127.0.0.1/admin' }),
});
const events = (await blocked.text()).trim().split('\n').map(JSON.parse);
assert.equal(events.at(-1).type, 'error');
assert.match(events.at(-1).message, /not a public listing/);
assert.equal(events.some(event => event.type === 'result'), false);
console.log('Production image smoke check passed; no providers configured or reachable.');
JS
