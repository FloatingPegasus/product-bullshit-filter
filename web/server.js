import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FetchError } from "./fetch-page.js";
import { researchProduct } from './research/research.js';
import { providerStatus } from './research/providers.js';

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 8787);

const publicDir = join(root, "web", "public");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function createAppServer({ research = researchProduct, configuration = providerStatus, publicOrigin = process.env.PUBLIC_ORIGIN || '', trustProxy = process.env.TRUST_PROXY === 'true', hourlyLimit = 5, dailyLimit = 60, now = Date.now } = {}) {
  const origin = publicOrigin ? new URL(publicOrigin).origin : '';
  if (publicOrigin && (origin !== publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');
  const clients = new Map();
  let daily = { count: 0, reset: 0 };
  let researching = false;
  const server = createServer(async (request, response) => {
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const expectedHost = `127.0.0.1:${server.address()?.port}`;
      const localhostHost = `localhost:${server.address()?.port}`;
      const allowedHosts = origin ? [new URL(origin).host] : [expectedHost, localhostHost];
      if (!allowedHosts.includes(request.headers.host)) return sendJson(response, 403, { ok: false, error: 'Use the configured website address.' });
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (request.method === 'GET' && url.pathname === '/healthz') return sendJson(response, 200, { ok: true });
      if (request.method === 'GET' && url.pathname === '/api/config') return sendJson(response, 200, { ok: true, ...configuration() });
      if (request.method === 'POST' && url.pathname === '/api/research') {
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '') || (request.headers.origin && request.headers.origin !== (origin || `http://${request.headers.host}`)) || request.headers['sec-fetch-site'] === 'cross-site') {
          return sendJson(response, 403, { ok: false, error: 'Start research from this website.' });
        }
        if (researching) return sendJson(response, 429, { ok: false, error: 'Another research request is running. Try again when it finishes.' });
        const payload = JSON.parse(await readBody(request));
        if (researching) return sendJson(response, 429, { ok: false, error: 'Another research request is running. Try again when it finishes.' });
        if (origin) {
          const time = now();
          for (const [key, value] of clients) if (value.reset <= time) clients.delete(key);
          if (daily.reset <= time) daily = { count: 0, reset: time + 86400000 };
          const address = trustProxy ? request.headers['x-real-ip'] || request.socket.remoteAddress : request.socket.remoteAddress;
          const client = clients.get(address) || { count: 0, reset: time + 3600000 };
          if (client.count >= hourlyLimit || daily.count >= dailyLimit) {
            response.setHeader('retry-after', String(Math.ceil(((daily.count >= dailyLimit ? daily : client).reset - time) / 1000)));
            return sendJson(response, 429, { ok: false, error: daily.count >= dailyLimit ? 'Today’s research allowance is used up. Please try again tomorrow.' : 'You’ve reached five checks this hour. Please try again later.' });
          }
          client.count++; daily.count++; clients.set(address, client);
        }
        researching = true;
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]);
        response.on('close', () => controller.abort());
        response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        const emit = data => { if (!response.destroyed) response.write(JSON.stringify(data) + '\n'); };
        try {
          const result = await research(payload, { signal, onProgress: message => emit({ type: 'progress', message }) });
          emit({ type: 'result', result });
        } catch (error) {
          emit({ type: 'error', message: error.status === 400 || error instanceof SyntaxError ? error.message : 'Research could not finish. Try again with the product name and exact variant.' });
        } finally { researching = false; response.end(); }
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendJson(response, 405, { ok: false, error: "Method not allowed." });
      }
      await sendFile(response, url.pathname, request.method === "HEAD");
    } catch (error) {
      if (error instanceof SyntaxError) error.status = 400;
      const status = error.status || (error instanceof FetchError ? error.status : 500);
      const message = status === 500 ? "The request could not be completed." : error.message;
      if (status === 500) console.error('Request failed:', error.name);
      sendJson(response, status, { ok: false, error: message });
    }
  });

  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

export const server = createAppServer();

if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, process.env.BIND_HOST || '127.0.0.1', () => {
  console.log(`Product Research listening on port ${port}`);
});

async function sendFile(response, pathname, headOnly) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = safeJoin(publicDir, relative);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": types[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    if (!headOnly) response.end(body);
    else response.end();
  } catch {
    sendJson(response, 404, { ok: false, error: "Not found." });
  }
}

function safeJoin(dir, requestPath) {
  const cleaned = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = join(dir, cleaned);
  if (full !== dir && !full.startsWith(dir + sep)) {
    const error = new Error("Not found.");
    error.status = 404;
    throw error;
  }
  return full;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > 8000) {
        reject(Object.assign(new Error("Request is too large."), { status: 413 }));

        return;
      }
      if (total <= 8000) chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}
