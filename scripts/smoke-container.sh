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
  if docker exec "$container" node -e 'fetch("http://127.0.0.1:8787/healthz", {headers:{host:"product-ci.invalid"}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" = 1
docker exec -i "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787';
const headers = { host: 'product-ci.invalid' };
const home = await fetch(base, { headers });
assert.equal(home.status, 200);
assert.match(await home.text(), /Product link/);
const config = await (await fetch(`${base}/api/config`, { headers })).json();
assert.deepEqual(config, { ok: true, searchConfigured: false, reasoningConfigured: false });
for (const url of ['/research-render.js', '/app.js', '/site.css']) {
  assert.equal((await fetch(`${base}${url}`, { headers })).status, 200);
}
const blocked = await fetch(`${base}/api/research`, {
  method: 'POST', headers: { ...headers, 'content-type': 'application/json', origin: 'https://product-ci.invalid' },
  body: JSON.stringify({ url: 'http://127.0.0.1/admin' }),
});
const events = (await blocked.text()).trim().split('\n').map(JSON.parse);
assert.equal(events.at(-1).type, 'error');
assert.match(events.at(-1).message, /not a public listing/);
assert.equal(events.some(event => event.type === 'result'), false);
console.log('Production image smoke check passed; no providers configured or reachable.');
JS
