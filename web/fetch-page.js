/** Fetch a public listing page. Refuses private hosts so a pasted URL cannot probe this machine. */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 12_000;

const BLOCKED = /captcha|robot check|not a robot|unusual traffic|api-services-support@amazon|enter the characters you see|access denied/i;

export class FetchError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function fetchListing(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const lookupImpl = options.lookupImpl || lookup;
  let current = await publicUrl(rawUrl, lookupImpl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current.href, {
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-IN,en;q=0.9",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new FetchError("The page redirected without a destination.", 502);
      current = await publicUrl(new URL(location, current).href, lookupImpl);
      continue;
    }
    if (!response.ok) {
      throw new FetchError(`The page returned ${response.status}.`, response.status === 404 ? 404 : 502);
    }
    const html = await readLimited(response);
    if (looksBlocked(html, response.status)) {
      throw new FetchError(
        "This marketplace blocked the server. Open the listing in Chrome and use the extension, which reads the page you already have open.",
        422,
      );
    }
    return { html, finalUrl: current.href };
  }
  throw new FetchError("The page redirected too many times.", 502);
}

export function looksBlocked(html, status) {
  if (status === 403 || status === 429 || status === 503) return true;
  const sample = String(html || "").slice(0, 6000);
  if (!BLOCKED.test(sample)) return false;
  return !/productTitle|application\/ld\+json|itemprop=["']price["']/i.test(String(html).slice(0, 20000));
}

export async function publicUrl(rawUrl, lookupImpl = lookup) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw new FetchError("That is not a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new FetchError("Use an http or https listing.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchError("That host is not a public listing.");
  }
  const addresses = isIP(host) ? [host] : (await lookupImpl(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length) throw new FetchError("That host did not resolve.", 502);
  if (addresses.some(isPrivateAddress)) {
    throw new FetchError("That host is not a public listing.");
  }
  return url;
}

function isPrivateAddress(address) {
  const ip = String(address || "").toLowerCase();
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  if (ip.startsWith("::ffff:")) return isPrivateAddress(ip.slice(7));
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FetchError("That page is too large to filter.", 413);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}
