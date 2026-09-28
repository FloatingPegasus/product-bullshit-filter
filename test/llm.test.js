import assert from "node:assert/strict";
import test from "node:test";
import { buildLlmRequest, mergeModelReport, parseModelJson, parseModelText } from "../extension/lib/llm.js";
import { buildReport } from "../extension/lib/report.js";
import { readFileSync } from "node:fs";

const scrape = JSON.parse(readFileSync(new URL("../extension/fixtures/earbuds.json", import.meta.url), "utf8"));

test("model requests never put the key in the body", () => {
  const request = buildLlmRequest(
    { provider: "openai", apiKey: "sk-test-secret", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    scrape,
  );
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.match(request.headers.authorization, /sk-test-secret/);
  assert.equal(JSON.stringify(request.body).includes("sk-test-secret"), false);
  assert.match(JSON.stringify(request.body), /Nova Buds/);

  const anthropic = buildLlmRequest(
    { provider: "anthropic", apiKey: "ant-secret", baseUrl: "https://api.anthropic.com", model: "claude-3-5-haiku-latest" },
    scrape,
  );
  assert.equal(anthropic.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(JSON.stringify(anthropic.body).includes("ant-secret"), false);
});

test("model prose is kept only when its evidence is on the page", () => {
  const local = buildReport(scrape, { now: new Date("2026-09-25T00:00:00Z") });
  const merged = mergeModelReport(
    local,
    {
      summary: "The page claims military-grade sound and up to 80 hours.",
      summaryEvidence: "Up to 80 hours of battery life",
      differentiators: [
        { title: "Ingress protection: IP55", detail: "Stated on the page.", evidence: "IP55 water and sweat resistance" },
        { title: "Invented codec: LDAC", detail: "Not real.", evidence: "supports LDAC and aptX HD" },
      ],
      gotchas: [{ title: "Case hours are the headline", detail: "Up to 80 hours is the case.", severity: "high", evidence: "Up to 80 hours of battery life" }],
    },
    scrape,
  );
  assert.equal(merged.verdict.score, local.verdict.score);
  assert.match(merged.verdict.summary, /military-grade/);
  assert.equal(merged.differentiators.length, 1);
  assert.match(merged.differentiators[0].title, /IP55/);
  assert.ok(merged.gotchas.some((item) => item.code === "battery"));
  assert.equal(merged.engine, "llm");
});

test("a summary that invents a percentage is rejected", () => {
  const local = buildReport(scrape, { now: new Date("2026-09-25T00:00:00Z") });
  const merged = mergeModelReport(local, { summary: "Exactly 42 percent of buyers reported a defect." }, scrape);
  assert.equal(merged.verdict.summary, local.verdict.summary);
  assert.match(merged.llmNote, /numbers/i);
});

test("fenced model JSON parses from both provider envelopes", () => {
  const parsed = parseModelJson("```json\n{\"summary\":\"IP55 is stated\"}\n```");
  assert.equal(parsed.summary, "IP55 is stated");
  const text = parseModelText("anthropic", { content: [{ type: "text", text: "{\"summary\":\"ok\"}" }] });
  assert.match(text, /ok/);
  const openai = parseModelText("openai", { choices: [{ message: { content: "{\"summary\":\"ok\"}" } }] });
  assert.match(openai, /ok/);
});


test("ungrounded qualitative summary and advice cannot silently replace local findings", () => {
  const local = buildReport(scrape);
  const merged = mergeModelReport(local, {summary:"This product is endorsed by every regulator.",betterment:[{title:"Buy immediately",detail:"Certified safe by regulators."}],questions:[{malformed:true}],gotchas:[]}, scrape);
  assert.equal(merged.verdict.summary,local.verdict.summary);
  assert.deepEqual(merged.betterment,local.betterment);
  assert.deepEqual(merged.gotchas,local.gotchas);
  assert.deepEqual(merged.questions,local.questions);
});


test('model endpoints reject insecure remote URLs and support local models without a key', () => {
  assert.throws(()=>buildLlmRequest({provider:'compatible',apiKey:'secret',baseUrl:'http://remote.example/v1'},scrape),/HTTPS/);
  const local=buildLlmRequest({provider:'compatible',apiKey:'',baseUrl:'http://localhost:11434/v1',model:'local'},scrape);
  assert.equal(local.headers.authorization,undefined);
  assert.equal(local.url,'http://localhost:11434/v1/chat/completions');
});
