/** Fetch a public listing page. Refuses private hosts so a pasted URL cannot probe this machine. */

import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

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
  const fetchImpl = options.fetchImpl || ((url, init) => fetchPublic(url, init, lookupImpl));
  const lookupImpl = options.lookupImpl || lookup;
  let current = await publicUrl(rawUrl, lookupImpl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    try {
      response = await fetchImpl(current.href, {
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-IN,en;q=0.9",
      },
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]),
      });
    } catch (error) {
      if (error instanceof FetchError) throw error;
      throw new FetchError(error.name === "AbortError" ? "The listing took too long to respond." : "Could not connect to that listing.", 502);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new FetchError("The page redirected without a destination.", 502);
      current = await publicUrl(new URL(location, current).href, lookupImpl);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FetchError(`The page returned ${response.status}.`, response.status === 404 ? 404 : 502);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
      await response.body?.cancel();
      throw new FetchError("That URL did not return an HTML product page.", 422);
    }
    let html;
    try { html = await readLimited(response); }
    catch (error) {
      if (error instanceof FetchError) throw error;
      throw new FetchError("The listing could not finish loading.", 502);
    }
    if (looksBlocked(html, response.status)) {
      throw new FetchError(
        "This store blocked access to its page. Research can still use other sources; add the product name and exact variant if they cannot be identified from the link.",
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
  if (url.username || url.password) throw new FetchError("Use a listing URL without credentials.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new FetchError("Use a standard http or https listing port.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchError("That host is not a public listing.");
  }
  let addresses;
  try { addresses = isIP(host) ? [host] : (await boundedLookup(host, lookupImpl)).map((entry) => entry.address); }
  catch { throw new FetchError("That host did not resolve.", 502); }
  if (!addresses.length) throw new FetchError("That host did not resolve.", 502);
  if (addresses.some(isPrivateAddress)) {
    throw new FetchError("That host is not a public listing.");
  }
  return url;
}

async function boundedLookup(host, lookupImpl) {
  let timer;
  try {
    return await Promise.race([
      lookupImpl(host, { all: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new FetchError('DNS lookup timed out.', 502)), 5000); timer.unref?.(); }),
    ]);
  } finally { clearTimeout(timer); }
}

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (!family) return true;
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

// Validate the addresses used by the socket, rather than checking DNS then
// letting fetch resolve an unchecked address on a second lookup.
export function publicLookup(lookupImpl = lookup) {
  return (hostname, options, callback) => {
    lookupImpl(hostname, { all: true }).then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        callback(new FetchError("That host is not a public listing."));
        return;
      }
      const records = addresses.map(({ address }) => ({ address, family: isIP(address) }));
      if (options.all) callback(null, records);
      else callback(null, records[0].address, records[0].family);
    }, () => callback(new FetchError("That host did not resolve.", 502)));
  };
}

function fetchPublic(rawUrl, init, lookupImpl) {
  const url = new URL(rawUrl);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      headers: init.headers,
      signal: init.signal,
      lookup: publicLookup(lookupImpl),
      agent: false,
    }, (response) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value != null) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const status = response.statusCode || 502;
      const empty = [204, 205, 304].includes(status);
      if (empty) response.resume();
      resolve(new Response(empty ? null : Readable.toWeb(response), { status, headers }));
    });
    request.on("error", reject);
    request.end();
  });
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
