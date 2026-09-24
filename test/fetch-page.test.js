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
