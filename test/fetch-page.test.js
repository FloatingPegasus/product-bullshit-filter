import assert from "node:assert/strict";
import test from "node:test";
import { FetchError, looksBlocked, publicUrl } from "../web/fetch-page.js";

const publicLookup = async () => [{ address: "93.184.216.34" }];

test("private and local hosts are refused", async () => {
  await assert.rejects(() => publicUrl("http://127.0.0.1/admin", publicLookup), /not a public listing/);
  await assert.rejects(() => publicUrl("http://localhost/secret", publicLookup), /not a public listing/);
  await assert.rejects(
    () => publicUrl("https://intranet.example", async () => [{ address: "10.1.2.3" }]),
    /not a public listing/,
  );
  await assert.rejects(() => publicUrl("file:///etc/passwd", publicLookup), /http or https/);
});

test("a public host is accepted", async () => {
  const url = await publicUrl("https://www.amazon.in/dp/B0TEST", publicLookup);
  assert.equal(url.hostname, "www.amazon.in");
});

test("a captcha page is treated as a block, a real listing is not", () => {
  assert.equal(looksBlocked("<html>robot check</html>", 200), true);
  assert.equal(looksBlocked('<html><span id="productTitle">Buds</span> unusual traffic</html>', 200), false);
  assert.equal(new FetchError("nope", 422).status, 422);
});

test('special-use IPv4 and IPv6 cannot bypass the public host check', async () => {
  for (const host of ['[::]', '[::ffff:7f00:1]', '[::ffff:a00:1]', '[fe90::1]', '[ff02::1]', '100.64.0.1', '198.18.0.1', '224.0.0.1']) {
    await assert.rejects(() => publicUrl(`http://${host}/`, publicLookup), /not a public listing/, host);
  }
  await assert.rejects(() => publicUrl('https://user:password@example.com/', publicLookup), /credentials/);
});

test('connection-time DNS validation blocks a rebound host', async () => {
  const { publicLookup: socketLookup } = await import('../web/fetch-page.js');
  let calls = 0;
  const rebinding = async () => [{address: ++calls === 1 ? '93.184.216.34' : '127.0.0.1'}];
  await publicUrl('https://shop.example/', rebinding);
  await assert.rejects(new Promise((resolve,reject) => socketLookup(rebinding)('shop.example', {all:true}, (error, addresses) => error ? reject(error) : resolve(addresses))), /not a public listing/);
});

test('fetch rejects private redirects, binary pages, oversized pages and network failures', async () => {
  const { fetchListing } = await import('../web/fetch-page.js');
  const options = (response) => ({lookupImpl:publicLookup,fetchImpl:async()=>response});
  await assert.rejects(fetchListing('https://shop.example/', options(new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}}))), /not a public listing/);
  await assert.rejects(fetchListing('https://shop.example/', options(new Response('binary',{headers:{'content-type':'application/pdf'}}))), /HTML product page/);
  await assert.rejects(fetchListing('https://shop.example/', options(new Response('a'.repeat(2_000_001),{headers:{'content-type':'text/html'}}))), /too large/);
  await assert.rejects(fetchListing('https://shop.example/', {lookupImpl:publicLookup,fetchImpl:async()=>{throw new Error('network');}}), /Could not connect/);
  const page=await fetchListing('https://shop.example/', options(new Response('<h1>Product</h1>',{headers:{'content-type':'text/html'}})));
  assert.equal(page.html,'<h1>Product</h1>');
});
