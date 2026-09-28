# Assessment — 25 September 2026

## Purpose

Useful for separating measurable listing details from unsupported claims and identifying missing seller/review evidence. Its score describes a page's evidence, not product quality or proven fraud. The deterministic website works on public HTML; stores that block server fetches require the extension or another source.

## Changes

- Closed the DNS-rebinding gap by validating the addresses used at socket connection time, as well as each redirect. Blocked special-use IPv4/IPv6 and mapped addresses while preserving TLS hostname validation.
- Bounded HTML, request bodies, redirects and timeouts; rejected binary pages and surfaced network failures. HTML parsing disables active scripts, styles and iframe loading and cleans up the parser window.
- Fixed malformed and oversized HTTP request handling and made the server importable for integration tests. Both servers bind to loopback by default.
- Prevented stale reports from surviving a new failed inspection. Improved extension loading, navigation cleanup and model busy states.
- Required source excerpts before model prose can replace local findings; retained local gotchas when unsupported model output is rejected. Validated model endpoints and supported keyless loopback models. Excerpt matching still cannot prove semantic accuracy.
- Replaced the decorative landing/report layout with a restrained inspection form, prominent listing identity and source excerpts. Secondary report sections expand on demand; copy failures are visible.
- Added security/integration/render regressions and maintenance documentation.

## Verification

`npm test`: **24 tests passed**, covering scoring, scraping, special-use IPs, socket-time rebinding, redirects/size/content failures, model boundaries, untrusted rendering and a real disposable HTTP server. Extension controller/options/settings passed JavaScript syntax checks. `git diff --check` passed. No additional runtime dependency or frontend framework was introduced.

Browser checks: both bundled listings returned the expected scores (84 and 0); a private URL was refused and cleared the previous report; a real public Books to Scrape listing returned its title and a score of 50. Verified the expandable specs section, desktop/390px layout, and clear browser console. Website requires no build step.

## Remaining limits

- Chrome toolbar, context menu, active-tab scraping and DOM marks have not been exercised in an installed extension. Loading the unpacked extension is waiting for approval because it grants page access. Shared scraping/rendering tests do not substitute for this browser integration check.
- No live or paid model request was made. Provider envelopes and grounding behavior were tested with fixtures; current credentials/provider behavior remains unverified.
- Marketplace anti-bot responses and client-rendered content limit server analysis. Review heuristics and English slogan rules are signals, not proof of deceptive conduct.
- Responsive checks used emulation. No exhaustive penetration, accessibility, or physical-device audit is claimed.

# Website research rebuild — 28 September 2026

## Direction

The primary product is now a link-first purchase research website. The extension-led workflow and static sidepanel mounts were removed from the website; prior extension files remain to preserve existing work and reuse its listing-analysis modules. The website captures needs, market, optional budget and exact variant, rather than pretending a URL alone establishes personal requirements.

## Implemented

- Added a bounded research pipeline: public listing read, five discovery searches, source retrieval, excerpt-backed discovery of up to two alternatives, targeted follow-up searches, and grounded comparison. Brave Search and an OpenAI-compatible reasoning provider are configured on the server only. There are no new runtime dependencies.
- Added provenance checks that withhold unsupported model claims. Search-only pages cannot support substantive findings. Alternative candidates require matching excerpts from at least two domains, including a retailer. These checks do not establish semantic correctness, independence or exact variant matching.
- Added a deterministic provisional listing trust score with visible coverage and component weights. Missing review/seller evidence earns no reassurance; unusable pages have an unknown score. Source counts and model prose cannot change this score. The score remains an experimental listing heuristic, not independently validated product quality.
- Added streamed progress, cancellation, a single active research request, report export, visible partial/error results, and server configuration status that does not claim a verified connection. Starting research clears the previous product.
- Kept socket-time DNS/redirect safety and inert parsing; added a bounded preflight DNS lookup, cancellation propagation, provider body limits, local host/origin checks and JSON-only research requests. Retired the old website listing-only API routes and sidepanel static mounts.
- Updated setup documentation and an ignored `.env` workflow. No credentials were read, created or changed, and no paid provider call was made.

## Verification

`npm test`: **36 tests passed**, including research brief validation, unknown/missing evidence, source grounding, provider envelope failures, credential separation, unsafe discovered URLs, blocked-listing fallback, candidate follow-up searches, actual HTTP streaming, concurrent-request rejection and cancellation propagation. `git diff --check` passed. Website has no build step.

Browser checks used the actual local website and a temporary local server with a synthetic provider, since live credentials are not configured. Verified loading both synthetic listings, the trust breakdown, request progress, streamed completion, cancellation, and a private-URL failure clearing the preceding result. Inspected desktop and 390px screenshots; mobile report scroll width matched 390px. Fixed the mobile heading spacing and budget-label alignment. Temporary test server was stopped. The website is available locally on port 8787.

## Not yet established

- No live Brave/model account integration or real cross-store recommendation was verified. Configuration is required before that can be exercised.
- No evaluation dataset establishes recommendation accuracy, score calibration, reviewer independence, precise product/variant matching or budget compliance. Those semantic judgments still depend on model interpretation of evidence. Category checklists establish fact presence, not performance standards or certification.
- No exhaustive store coverage, checkout-price/stock guarantee, persistent research history or physical-device performance claim. Anti-bot and client-rendered pages remain evidence gaps, not a reason to install an extension.

# Gateway support and interface cleanup — 28 September 2026

- Inspected the sibling AI Gateway contract without modifying that project or reading/reusing its app credentials. The deployed `/v1/models` endpoint returned HTTP 401 without credentials, confirming authentication is required; no authenticated inference was attempted.
- Added gateway defaults (`https://ai.kanishq.dev/v1`, `standard`), server-side `OPENAI_*` environment compatibility, the gateway's `max_tokens` contract and explicit completion checks. `npm start` now loads an existing `.env` without replacing it. A dedicated product-app key is still required.
- Fixed listing-only AI assessment: lack of a web-search key no longer prevents reasoning over a readable selected listing. Search coverage remains explicitly absent. Removed the uncited AI introduction and reject quantitative claims whose numbers are absent from the excerpts or user brief.
- Removed the promotional layout, method cards, demo controls/routes, report export, category-presence checklist, repeated empty sections and narrative comments in the research module. Moved synthetic report construction out of runtime code into `support/`. The page now has a compact form and a report led by listing flags, followed by supported findings, specs and inspectable sources.
- `npm test`: **39 passing tests**. Added regressions for gateway configuration/request shape, incomplete model responses, AI without search, and invented quantitative claims. `git diff --check` and JavaScript syntax checks passed.
- Browser checks covered desktop and 390px layouts, synthetic report rendering, streamed progress, cancellation and clearing the preceding report on error. Mobile report width was 390px with no horizontal overflow. The temporary fixture server was stopped after testing. No physical-phone performance or live model/search integration is claimed.

Remaining dependency: provide this app's dedicated production gateway key; cross-store discovery additionally requires a search credential. No gateway deployment, sibling project or existing credential was changed.

# Production release — 28 September 2026

- Built and deployed ARM64 image `product-research:20260928-2` to the existing VM, in a separate Compose project. Image identity: `sha256:389e007a68bc6d332d8ca6f73bf7f493d3b112943f018b9d0dfba9505780cf55`. The container is non-root, read-only, resource-limited and healthy. Prior image, runtime configuration and source archive are retained under `/opt/product-research/releases/`.
- Issued a dedicated production gateway key restricted to the live `quality` alias, four requests per minute and one concurrent request. Saved it only in the private production environment. The live gateway has not yet adopted the sibling source's `standard` alias; no gateway or Cadence release was changed.
- Added strict public host/HTTPS origin checks, CSP and privacy headers, process health endpoint, and bounded public request allowances. App counters are process-local and reset on restart. Caddy supplies the client address over a private container network; the app port is not published.
- One synthetic live gateway check produced a grounded fit and finding. A real Apple specification-page check returned two grounded findings and one fit row; three unsupported model claims were removed. Raspberry Pi's product page returned HTTP 403 from the server and remained unscored. This confirms working inference and blocked-source handling, not universal store access or recommendation accuracy.
- The Apple check revealed an inherited false positive: a footnote appended to “Hearing Test” was interpreted as a foreign product name. Removed that unreliable heuristic. Scores now require at least 40% weighted evidence coverage; sparse extraction produces “Unknown” instead of a misleading low score. Added concrete regressions.
- **41 tests passed** locally and inside the final Node 22 container. Desktop and 390px browser layouts were inspected, and a private URL was refused visibly. Existing Cadence health stayed HTTP 200; public gateway model access still requires authentication (401), and management remains inaccessible (404).
- Product HTTPS routing was added after validating the combined Caddy configuration and saving its prior contents. Saved the Name.com A record `product.kanishq.dev → 92.4.94.15` with TTL 300; authoritative DNS and Cloudflare DNS return that address. Public HTTPS passed certificate validation and returned HTTP 200 from `/healthz`. Production configuration confirms reasoning is enabled and search is absent; a private-URL research request is refused. Cadence health remains HTTP 200. This Mac's ISP resolver still caches NXDOMAIN (one-hour negative TTL), preventing a final public-domain browser check; the earlier desktop and mobile browser checks remain the UI verification.

Cross-store search remains unconfigured. No search account, paid plan, or new VM was created. There is no live cross-store recommendation validation, calibrated trust-score evaluation, exhaustive security audit, or physical-phone performance claim.

# Free search release — 28 September 2026

- Replaced the unused Brave adapter with Tavily basic search. The Researcher account has 1,000 monthly credits, pay-as-you-go disabled, and no card was added. The existing default key is stored only in the private production environment; its temporary local transfer file was removed. No paid plan was activated.
- Search sends credentials only in the Authorization header, explicitly disables automatic search-depth selection and generated answers, bounds results and response size, refuses redirects, and rejects malformed results. Search snippets remain discovery data rather than recommendation evidence. Quota errors do not trigger adapter retries or paid fallback.
- Deployed `product-research:20260928-3`, image identity `sha256:544a07ec0265efa34366dff44724a8761a35c9f00e56c2713cefc90634a88acc`. The initial Docker build failed because its default network could not resolve npm; rebuilding with the host network succeeded. Runtime network isolation is unchanged. All 41 tests passed locally and inside the final Node 22 image.
- The public HTTPS website now opens in the browser. A real Apple AirPods Pro check found 10 sources and read 7, including retailer and manufacturer pages. The model's alternative-discovery step failed, and the report visibly marked comparison incomplete; no better alternative was claimed. Three unsupported model claims were removed. This validates live search integration, not recommendation quality.
- A second browser request using a loopback URL was refused and cleared the previous product report. Production is healthy with search and reasoning configured; Cadence health remains HTTP 200. Search billing is zero within the free allowance; no claim is made that existing hosting or model infrastructure is inherently free.

# Self-hosted search with free fallback — 28 September 2026

- Made private SearXNG the primary search provider, with Tavily basic search used only when the primary request fails or returns no results. A partial primary response with usable results remains usable and gets a visible warning. Cancellation never starts a fallback. Exhausting the optional Tavily allowance produces a visible search failure; there is no third or paid search fallback.
- Deployed `product-research:20260928-4`, image identity `sha256:479b278247ee4de808c0a88aa093cc55776ccfd684945d6c310878326685aeba`, alongside the official SearXNG image pinned to `sha256:5286edb35782454ab8a102c5eff6b54bff745853191b46aeead95f225aa6dfb6`. The new service has no published port, runs as UID 977 with a read-only filesystem, and shares a private network only with this app. Credentials and its generated secret remain in private server files. Existing gateway and Cadence services were preserved.
- Trial queries for Sony headphones and an Anker power bank returned relevant sources. Removed Bing after it contributed generic brand pages in those trials; production uses Google and DuckDuckGo. Self-hosting removes per-query API charges and monthly API credits for the primary provider, but upstream engines can still block or limit requests. Existing server, model and public-app usage limits still apply.
- **48 tests passed** locally and inside the final Node 22 image. Focused checks cover credential separation, keyless primary search, malformed/empty/failed primary responses, partial-engine disclosure, cancellation, exhausted fallback and provenance reporting. `git diff --check` passed. Automatic fallback behavior was verified synthetically, without forcing a production outage or consuming credits to test exhaustion.
- A public-domain browser run for Sony WH-1000XM5 found 11 sources and read 2 using SearXNG only. The selected Sony page was inaccessible, so listing trust stayed Unknown. Some engines were unavailable; the report disclosed partial discovery, removed three unsupported model claims, and did not establish a better alternative. A refreshed Tavily dashboard remained at **5 / 1,000 credits**, with pay-as-you-go off. This establishes live primary integration, not exhaustive coverage or reliable recommendation quality.
- Inspected desktop and 390px report screenshots; mobile content width matched 390px. A loopback URL was visibly rejected and cleared the previous report. App and search containers were healthy; the search service used approximately 85 MB RAM and Cadence health remained HTTP 200. No new VM, card or paid search plan was added. Hosting and model costs remain separate from the zero-cost search arrangement.

# GitHub Actions deployment — 29 September 2026

- Committed the deployed website source and added a pinned-action workflow for the existing public repository. Pull requests test and build; pushes to `main` and manual runs on `main` deploy. README/audit/agent-instruction-only changes skip deployment. Standard ARM64 runners build the image and transfer it directly to the existing VM, without registry storage, uploaded Actions artifacts or a new server.
- Installed an app-specific forced-command SSH receiver. GitHub has a new restricted deployment key and pinned host keys; the personal SSH key and provider credentials remain outside GitHub. Verified that the new key refuses an arbitrary `id` command. Removed its temporary local files after installing the encrypted repository secrets.
- Releases have unique commit/run/attempt image tags and record the image ID. The receiver rejects unrelated tags, wrong architecture/revision, incomplete transfers and oversized archives; serializes rollouts; checks container and HTTPS health; and restores the previous image on activation failure. Receiver code and the Compose infrastructure template remain separately installed server configuration. No production failure was deliberately induced to exercise rollback.
- **55 tests passed** locally and in GitHub, including seven focused deployment tests covering command restrictions, image rejection, incomplete transfer, successful activation and both container/HTTPS rollback paths. Shell syntax and whitespace checks passed. Runtime app code and page layout were unchanged in this deployment work.
- [Workflow run 36470205734](https://github.com/FloatingPegasus/product-bullshit-filter/actions/runs/36470205734) successfully built and deployed commit `cc7ba90c5f6231f8f45c41855d680a27b8cd8071`; the release job took 50 seconds. The server's current release points to `git-cc7ba90c5f6231f8f45c41855d680a27b8cd8071-36470205734-1`. The app container is healthy and the public browser page loads. A loopback URL was visibly refused without a provider call. Neighboring Cadence and gateway containers were healthy after deployment; their configuration was not changed by this workflow.
