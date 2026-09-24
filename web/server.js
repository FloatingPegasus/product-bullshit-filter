/** Website for Product Bullshit Filter. Paste a URL, or run a bundled sample. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFixture, analyzeUrl } from "./analyze.js";
import { FetchError } from "./fetch-page.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 8787);

const mounts = [
  { prefix: "/lib/", dir: join(root, "extension", "lib") },
  { prefix: "/sidepanel/", dir: join(root, "extension", "sidepanel") },
  { prefix: "/fixtures/", dir: join(root, "extension", "fixtures") },
  { prefix: "/", dir: join(root, "web", "public") },
];

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readBody(request);
      const payload = JSON.parse(body || "{}");
      const result = await analyzeUrl(payload.url);
      return sendJson(response, 200, { ok: true, ...result });
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/sample/")) {
      const name = url.pathname.slice("/api/sample/".length);
      const report = await analyzeFixture(name);
      return sendJson(response, 200, { ok: true, report });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { ok: false, error: "Method not allowed." });
    }
    await sendFile(response, url.pathname, request.method === "HEAD");
  } catch (error) {
    if (error instanceof SyntaxError) error.status = 400;
    const status = error.status || (error instanceof FetchError ? error.status : 500);
    const message = status === 500 ? "The filter failed on that page." : error.message;
    if (status === 500) console.error(error);
    sendJson(response, status, { ok: false, error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Product Bullshit Filter site at http://127.0.0.1:${port}`);
});

async function sendFile(response, pathname, headOnly) {
  const mount = mounts.find((entry) => entry.prefix === "/" || pathname.startsWith(entry.prefix));
  if (!mount) return sendJson(response, 404, { ok: false, error: "Not found." });
  const relative = mount.prefix === "/" ? (pathname === "/" ? "index.html" : pathname.slice(1)) : pathname.slice(mount.prefix.length);
  const filePath = safeJoin(mount.dir, relative);
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
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}
