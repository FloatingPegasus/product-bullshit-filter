# Bullshit Filter

Paste a product link, add what matters to you, and check its claims, specifications and seller terms. With AI and search configured, the app also evaluates fit and investigates alternatives. No extension is required.

## Run

Use Node 22.18+ or current LTS.

```sh
npm ci
npm start
```

Open [127.0.0.1:8787](http://127.0.0.1:8787). The server binds to loopback and reads `.env` if present. There is no build step. Reports stay in browser memory; no accounts, history or export feature.

## AI gateway

The default reasoning endpoint is `https://ai.kanishq.dev/v1`, using the `standard` alias. Copy `.env.example` to `.env` only if `.env` does not already exist. Add a dedicated gateway app key with permission to use `standard`. Never reuse another app's key or put an admin/provider key in this app.

```dotenv
OPENAI_BASE_URL=https://ai.kanishq.dev/v1
OPENAI_API_KEY=<dedicated product-app key>
RESEARCH_MODEL=standard
SEARXNG_URL=http://product-search:8080
TAVILY_API_KEY=<optional free-tier backup key>
```

Restart `npm start` after changing the environment. Keys stay on the server and are excluded from logs, reports and model request bodies.

The gateway is used for interpreting the supplied listing, requirements and source evidence. It does not supply web search. AI analysis of a readable listing works without a search key; cross-store research requires the private SearXNG service or `TAVILY_API_KEY`. Neither missing service is presented as completed research.

The adapter follows the gateway's tested Chat Completions contract: JSON object output, `max_tokens`, a total deadline, and a successful `stop` finish reason. Model requests have no automatic retries or provider fallback. The standard route has a 45-second caller deadline; deep has 75 seconds. A run makes up to two model calls and nine search calls, and reads up to nineteen public pages under a three-minute overall deadline. Cancellation closes outstanding requests but cannot undo work already performed upstream.

For another compatible endpoint, explicitly set `RESEARCH_MODEL_BASE_URL`, `RESEARCH_MODEL_KEY` and `RESEARCH_MODEL`; those values take precedence over the gateway-compatible environment variables. Non-gateway adapters send `max_completion_tokens`. HTTP is allowed only for loopback model endpoints. Provider compatibility must be verified separately.

Gateway contract: [local gateway README](../ai-gateway/README.md). Production requires a key issued on the deployed instance; local-development keys are separate. Gateway documentation currently limits the upstream trial to public/synthetic data pending a suitable privacy arrangement. Do not put private information in a buying brief.

## What is checked

- The local rules inspect measurable specs, conflicting claims, seller/warranty/returns text and visible review patterns.
- The deterministic listing trust score weights specs (35), seller terms (25), review evidence (20), and consistency/completeness (20). Missing evidence earns no reassurance; fewer than 40% of weighted evidence means no score. This is an experimental listing heuristic, not a product-quality or authenticity rating.
- AI findings need matching source excerpts. Numerical claims absent from the quoted evidence or brief are dropped. Matching text does not establish a correct interpretation.
- Search snippets can identify candidates but cannot support recommendations. Alternatives require two source domains, including a retailer, a stated advantage and a tradeoff. Exact variant, budget, source independence and recommendation quality still need validation.

The report leads with listing flags, then supported fit/findings and alternatives when available. Specifications, seller terms, score breakdown and source links remain inspectable. Store blocks and provider failures are shown explicitly. Starting a new check clears the old report.

## Development

```sh
npm run check
npm test
```

Local checks require Node 22.18+, Bash and Python 3. Tests use fixtures and mocked providers, including disposable loopback servers. No paid calls run as routine tests. Synthetic reports live in `support/research-fixture.js`, with data under `test/fixtures/`; the website exposes no demo endpoints.

`POST /api/research` accepts JSON `{url, needs, market, budget, productHint}` and streams NDJSON `progress`, `result`, or `error` events. Markets are `IN`, `US`, `GB`; budget is a positive number or `null`. `GET /api/config` returns configuration flags, not a live connection check.

`web/research/` contains orchestration and server-only adapters. `web/listing/` contains the scraper and deterministic analysis. `web/public/` contains the interface. Fetching validates public addresses at socket connection and each redirect, preserves TLS checks, bounds content/time, and parses HTML without scripts or subresources.

See [AGENTS.md](AGENTS.md) and [AUDIT.md](AUDIT.md) for maintenance rules and verification history.

## Deployment

The app runs on the existing ARM64 VM in its own `product-research` Compose project. Runtime configuration is private at `/opt/product-research/shared/.env`; never overwrite it from a local example. The installed gateway currently exposes `quality`, so production explicitly uses that alias with a dedicated restricted key. Switching to `standard` requires the gateway and key grant to support it first.

The [CI and deployment workflow](https://github.com/FloatingPegasus/product-bullshit-filter/actions/workflows/deploy.yml) checks JavaScript, shell and Python syntax, audits production dependencies for high-severity vulnerabilities, and runs the regression suite. Only passing checks allow the ARM64 production image to build. A disposable container with external networking disabled must then serve the website and assets, report providers as unconfigured, and reject a private research URL. Pull requests stop after validation. A push to `main`, or a manual workflow run on `main`, deploys that same tested image. Changes limited to README, audit notes or agent instructions skip the workflow. Standard GitHub runners are free for this public repository. The workflow transfers the image directly to the existing server; it does not use a paid registry, retained Actions artifacts, or another VM.

GitHub stores a dedicated `PRODUCT_DEPLOY_KEY`, pinned `PRODUCT_KNOWN_HOSTS`, and a `PRODUCT_DEPLOY_HOST` repository variable. The key's server entry uses `restrict,command="/opt/product-research/deploy/receive.sh"`; it cannot open a shell, forward ports, or run arbitrary SSH commands. The personal SSH key and app/provider credentials are not copied into GitHub. Workflow actions are pinned to commit IDs; pull requests receive no deployment secrets.

The server's `/opt/product-research/deploy/` contains the reviewed `receive.sh`, `validate-image.py`, and `compose.yaml` from `deploy/`. These infrastructure files are installed separately through the owner's SSH access; changing them in Git alone does not update the receiver. `/opt/product-research/current` points to the last healthy release. Every workflow attempt gets a unique `git-COMMIT-RUN-ATTEMPT` release, image, recorded image ID, and `release.env`. The receiver validates the image tag, architecture and source revision, serializes deployments, waits for container health, then checks the HTTPS route through Caddy. A failed activation or HTTPS check restores the prior app image. The existing search service, proxy, private environment, and other projects are preserved.

For a manual rollback, run `docker compose --env-file /opt/product-research/releases/RELEASE/release.env -f /opt/product-research/releases/RELEASE/compose.yaml up -d --no-build --wait app`, verify HTTPS health, and point `current` to that release. For releases predating the workflow, use `--env-file /dev/null`. Previous images and release directories are retained; the uploaded archive is removed after loading. No database or report storage is used.

`PUBLIC_ORIGIN=https://product.kanishq.dev` enables strict production Host/origin checks and limits research to five checks per client IP per hour, sixty per app per day, and one simultaneous run. Counters are in memory and reset on restart; these are small-deployment safeguards, not account quotas. `TRUST_PROXY=true` is safe only behind the private proxy network where Caddy overwrites `X-Real-IP`. Do not publish the container port directly. Its read-only container has resource limits and a restart policy.

`deploy/Caddyfile.fragment` is the product route in the shared Caddy configuration at `/opt/cadence-edge/releases/20260928-2/Caddyfile`. The pre-product configuration is backed up at `/opt/product-research/releases/20260928-1/Caddyfile.before-product`. Preserve all other host blocks during proxy changes. HTTPS certificates are managed by Caddy. `GET /healthz` checks the app process; `/api/config` shows configured services, not upstream availability.

Cross-store research first uses a private SearXNG service on the existing VM, with Google and DuckDuckGo engines. It has no API-credit charge or monthly search-credit cap, but upstream engines can block or rate-limit it. The service has no public port, uses a separate container network shared only with the app, and is capped at 512 MB RAM and half a CPU. Copy `deploy/searxng-settings.yml` into `/opt/product-research/shared/searxng/settings.yml` and replace its secret placeholder with a random value before starting Compose. The private service does not use SearXNG's public-instance limiter; the website's request limits still apply.

`SEARXNG_URL` is a server-only HTTPS origin, or the private `http://product-search:8080` service. Leave it blank for Tavily-only operation. SearXNG failures or empty results can fall back once to the optional `TAVILY_API_KEY`; cancellation never triggers fallback. Partial engine failures and fallback are disclosed in reports, with the search providers listed under Sources. Search results supply discovery links and snippets only; each evidence page is fetched and checked independently.

Keep Tavily on its Researcher free plan (1,000 monthly credits, no card required), with pay-as-you-go disabled and no payment method. Its requests stop when the free credits run out. Basic search uses one credit per query, with automatic search-depth selection disabled. A check can make five initial searches and up to four candidate-verification searches; the free allowance alone covers about 111–200 checks per month. With healthy SearXNG results those credits are preserved. There is no paid search fallback. Existing model gateway and hosting costs remain separate.
