/** Optional model pass. It may rewrite prose. It may not invent facts, and it may not change the score. */

import { buildCorpus, corpusContains, norm, numbersIn } from "./text.js";

const INSTRUCTIONS = [
  "You are extracting a structured product analysis from a marketplace listing that was already scraped.",
  "Use only the listing JSON. Do not invent specifications, prices, certifications, review counts, or seller terms.",
  "Every evidence string must be a verbatim excerpt from the listing, at least 12 characters.",
  "Prefer measurable facts over adjectives.",
  "Return JSON with this shape:",
  '{"summary":"","differentiators":[{"title":"","detail":"","evidence":""}],"marketing":[{"text":"","reason":"","evidence":""}],"gotchas":[{"title":"","detail":"","severity":"high|medium|low","evidence":""}],"betterment":[{"title":"","detail":""}],"questions":[""]}',
  "differentiators: at most 5 comparable facts that are actually written on the page.",
  "If a figure is an 'up to' ceiling, say so in the detail.",
  "Do not include a score. The extension computes the score itself.",
].join(" ");

export function buildLlmRequest(settings, scrape) {
  const apiKey = norm(settings?.apiKey);
  if (!apiKey) {
    throw new Error("Add an API key in Model settings.");
  }
  const provider = settings.provider === "anthropic" ? "anthropic" : "openai";
  const listing = compactScrape(scrape);
  if (provider === "anthropic") {
    const base = trimSlash(settings.baseUrl || "https://api.anthropic.com");
    return {
      provider,
      url: `${base}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model: settings.model || "claude-3-5-haiku-latest",
        max_tokens: 2500,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: `${INSTRUCTIONS}\n\nListing:\n${JSON.stringify(listing)}`,
          },
        ],
      },
    };
  }
  const base = trimSlash(settings.baseUrl || "https://api.openai.com/v1");
  return {
    provider,
    url: `${base}/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: settings.model || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: JSON.stringify(listing) },
      ],
    },
  };
}

export function parseModelText(provider, responseJson) {
  if (provider === "anthropic") {
    const block = (responseJson?.content || []).find((part) => part?.type === "text" && part.text);
    return block?.text || "";
  }
  return responseJson?.choices?.[0]?.message?.content || "";
}

export function parseModelJson(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The model did not return JSON.");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function refineWithLlm(scrape, localReport, settings, fetchImpl = globalThis.fetch) {
  const request = buildLlmRequest(settings, scrape);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        payload?.error?.message || payload?.error?.error?.message || response.statusText || "Request failed";
      throw new Error(`Model request failed (${response.status}): ${String(message).slice(0, 180)}`);
    }
    const parsed = parseModelJson(parseModelText(request.provider, payload));
    return mergeModelReport(localReport, parsed, scrape);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The model took too long. The local report is still in front of you.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function mergeModelReport(localReport, model, scrape) {
  const corpus = buildCorpus(scrape);
  const notes = [];
  const next = {
    ...localReport,
    verdict: { ...localReport.verdict },
    engine: "local",
  };

  if (typeof model?.summary === "string" && model.summary.trim()) {
    if (summaryAllowed(model.summary, corpus, localReport.verdict.score)) {
      next.verdict.summary = norm(model.summary).slice(0, 900);
      next.engine = "llm";
    } else {
      notes.push("The model summary was dropped because it added numbers that are not on the page.");
    }
  }

  const differentiators = groundedObjects(model?.differentiators, corpus, ["title", "detail", "evidence"]).slice(0, 5);
  if (differentiators.length) {
    next.differentiators = differentiators.map((item, index) => ({
      rank: index + 1,
      title: item.title,
      detail: item.detail,
      evidence: item.evidence,
      source: "model",
      conditional: /\bup to\b/i.test(`${item.title} ${item.detail}`),
    }));
    next.engine = "llm";
  } else if (Array.isArray(model?.differentiators) && model.differentiators.length) {
    notes.push("The model's differentiators were dropped because their evidence is not on the page.");
  }

  const marketing = groundedObjects(model?.marketing, corpus, ["text", "evidence"]).slice(0, 12);
  if (marketing.length) {
    next.marketing = marketing.map((item) => ({
      text: item.text,
      reason: item.reason || "Flagged by the model",
      severity: cleanSeverity(item.severity),
      codes: ["model"],
      source: "model",
    }));
    next.engine = "llm";
  }

  const modelGotchas = groundedObjects(model?.gotchas, corpus, ["title", "detail", "evidence"]).map((item) => ({
    code: "model",
    severity: cleanSeverity(item.severity),
    title: item.title,
    detail: item.detail,
  }));
  const localKept = (localReport.gotchas || []).filter((item) => item.severity === "high" || item.severity === "medium");
  const mergedGotchas = dedupeGotchas([...localKept, ...modelGotchas]).slice(0, 8);
  if (modelGotchas.length) next.engine = "llm";
  next.gotchas = mergedGotchas;

  const betterment = arrayOfObjects(model?.betterment, ["title", "detail"]).slice(0, 5);
  if (betterment.length) {
    next.betterment = betterment;
    next.engine = "llm";
  }
  const questions = Array.isArray(model?.questions)
    ? model.questions.map((item) => norm(item)).filter((item) => item.length > 8 && item.length < 240).slice(0, 5)
    : [];
  if (questions.length) {
    next.questions = questions;
    next.engine = "llm";
  }

  next.llmNote = notes.join(" ");
  next.limits = [
    ...(localReport.limits || []),
    next.engine === "llm"
      ? "A model rewrote the narrative. The score, seller check, and review check stayed on local rules, and model lines had to match text from the page."
      : "",
  ].filter(Boolean);
  return next;
}

function compactScrape(scrape) {
  return {
    title: scrape.title,
    brand: scrape.brand,
    marketplace: scrape.marketplace,
    url: scrape.url,
    price: scrape.price,
    availability: scrape.availability,
    rating: scrape.rating,
    histogram: scrape.histogram,
    bullets: (scrape.bullets || []).slice(0, 20),
    description: norm(scrape.description).slice(0, 2500),
    specs: (scrape.specs || []).slice(0, 40),
    seller: scrape.seller,
    warranty: scrape.warranty,
    returns: scrape.returns,
    badges: scrape.badges || [],
    reviews: (scrape.reviews || []).slice(0, 12).map((review) => ({
      stars: review.stars,
      title: review.title,
      body: norm(review.body).slice(0, 500),
      date: review.date,
      verified: review.verified,
      incentivized: review.incentivized,
    })),
  };
}

function groundedObjects(value, corpus, fields) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const evidence = norm(item.evidence || item.text || "");
      if (!corpusContains(corpus, evidence)) return null;
      const next = { evidence };
      for (const field of fields) {
        if (field === "evidence") continue;
        next[field] = norm(item[field]).slice(0, 400);
      }
      if (fields.includes("title") && !next.title) return null;
      if (fields.includes("text") && !next.text) next.text = evidence;
      const blob = fields.map((field) => next[field] || "").join(" ");
      if (!numbersAllowed(blob, corpus)) return null;
      return next;
    })
    .filter(Boolean);
}

function arrayOfObjects(value, fields) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const next = {};
      for (const field of fields) next[field] = norm(item[field]).slice(0, 400);
      if (!next.title) return null;
      return next;
    })
    .filter(Boolean);
}

function summaryAllowed(summary, corpus, score) {
  return numbersAllowed(summary, corpus, [String(score)]);
}

function numbersAllowed(text, corpus, extra = []) {
  const allowed = new Set([...numbersIn(corpus), ...extra]);
  return numbersIn(text).every((number) => allowed.has(number));
}

function cleanSeverity(value) {
  return value === "high" || value === "low" ? value : "medium";
}

function dedupeGotchas(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = norm(item.title).toLowerCase().slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}
