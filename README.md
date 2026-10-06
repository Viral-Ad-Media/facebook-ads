# Facebook Ads Studio

A Next.js console for researching competitors, preparing ad briefs, reviewing generated creatives,
queuing Meta campaigns, and viewing performance. **Claude Code is the execution engine**: the web
app writes jobs to hosted Postgres; separately invoked skills use MCP connectors to generate
media, publish campaigns, sync insights, and apply optimization proposals.

> Repository audit: October 6, 2026. The production build passes, but spend controls, queue
> reliability, dependency security, and deployment reproducibility need work before unattended
> operation. See [AUDIT.md](AUDIT.md) for evidence and recommended fixes.

## Architecture

- **Web app:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Recharts, Lucide.
- **Database:** hosted Postgres, intended to be a Supabase project with an isolated `fbads` schema.
  The app uses `postgres`; there is no SQLite dependency or local database initialization.
- **Engine:** four instruction-based Claude Code skills under `.claude/skills/`. They are not a
  bundled background worker and do not run automatically when a UI button is clicked.
- **Integrations:** Supabase MCP for engine database access, Facebook Ads MCP for Ads Library,
  publishing and insights, Higgsfield MCP for media, and kie-ai MCP as a generation fallback.
  Connector credentials belong to the engine environment, not the browser.
- **Assets:** hosted `asset_url` is preferred. `asset_path` can point to a local file in
  `public/assets/`; files generated on an engine machine are not automatically deployed.

Both the app and engine must point to the same database. Web routes queue requests rather than
calling Meta or media providers directly. Browser polling only refreshes stored state; it does
not process jobs.

## Pages and workflow

| Page | Purpose | Engine step |
| --- | --- | --- |
| `/` | Campaigns, spend/CTR chart, ad/campaign toggles, action log | `/monitor` for insights; `/launch` for queued toggles |
| `/competitors` | Queue scans, browse/star/delete stored ads, use angles as inspiration | `/competitor-scan` |
| `/studio` | Briefs, image/video variants, copy editing, mock previews, approval | `/process-jobs` |
| `/launch` | Select approved creatives, objective, audience profile, daily budget | `/launch` |
| `/learnings` | Stored hook, format, audience, offer and media observations | `/monitor` and competitor scans |
| `/settings` | Account/Page IDs, guardrails, ideal customer profiles | Read by engine skills |
| `/login` | Shared-password access gate | No engine required |

First-run onboarding and the navigation's **Replay intro & tour** explain the workflow. Onboarding
completion is stored in the browser, not in a user account.

1. Configure database access and connector access as described below.
2. In **Settings**, set the Facebook Page/ad account IDs, create an ICP, and review guardrails.
3. Optionally queue a competitor search, then invoke `/competitor-scan` in Claude Code.
4. Create a brief in **Ad Studio**, invoke `/process-jobs`, and inspect its copy and media.
5. Approve variants, select them in **Launch**, and queue a campaign.
6. Invoke `/launch` to create Meta entities. The skill instructs the engine to create them
   **PAUSED** first; review the actual Meta configuration before activating.
7. Dashboard activation/pause buttons queue further jobs; invoke `/launch` to execute them.
8. Invoke `/monitor` to sync metrics, propose/execute changes, and extract learnings.

A monitoring cadence such as every six hours requires a separately configured scheduler.
This repository contains no cron configuration or continuously running engine.

## Local setup

Use **Node.js 22 LTS or newer** and npm. The rules script uses `process.loadEnvFile`; older Node
versions without that API silently skip `.env.local` loading. Audit build used Node 24.19.0.

```bash
git clone https://github.com/Viral-Ad-Media/facebook-ads.git
cd facebook-ads
npm install
cp .env.example .env.local
# Fill in .env.local before using database-backed pages.
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

No dependency lockfile is committed, so `npm ci` is currently unavailable and installs can differ.
Normal installation runs the `ffmpeg-static` download script; the local video workflow requires
that binary or a separately installed ffmpeg.

### Environment variables

| Variable | Used by | Requirement |
| --- | --- | --- |
| `DATABASE_URL` | Next.js APIs and rules script | Postgres connection URL for the app role; required at query time |
| `SUPABASE_PROJECT_ID` | Claude Code skills using Supabase MCP | Project containing the same `fbads` schema |
| `ADMIN_PASSWORD` | Login route and middleware | Required for production access; optional in development |

The example uses a Supabase transaction pooler on port 6543 with username
`fbads_app.PROJECT_REF`. The client sets `prepare: false`, requests TLS, and opens at most five
connections per client instance. Supply a correctly encoded password in the connection URL.
Do not expose these variables through `NEXT_PUBLIC_*` or commit `.env.local`.

### Database prerequisites

**The repository does not include schema migrations, role provisioning SQL, or seed scripts.**
A fresh clone cannot create a working database by itself. Obtain the existing schema migration
(referenced in `CLAUDE.md` as `fbads_studio_schema`) or prepare reviewed migrations before setup.

The app assumes the dedicated database role has a `search_path` resolving unqualified table names
to `fbads`, and suitable grants on its tables/sequences. Engine SQL explicitly uses
`fbads.<table>`. Database privilege isolation described in `CLAUDE.md` is an external prerequisite;
it cannot be verified from this repository.

Required tables inferred from queries and skill instructions:

| Tables | Purpose |
| --- | --- |
| `settings`, `icp_profiles` | String-valued settings and audience profiles |
| `briefs`, `creatives` | Creative requests, copy, assets, status, provider IDs |
| `campaigns`, `ad_sets`, `ads` | Local campaign state and Meta entity IDs |
| `metrics_daily` | Per-ad daily performance; engine expects uniqueness on ad/date |
| `jobs` | Pending/running/done/failed requests and JSON payload/results |
| `engine_actions` | Proposed/executed engine actions and metric snapshots |
| `competitor_ads` | Ads Library observations; engine expects unique library IDs |
| `learnings` | Insights, evidence, confidence and update time |

This is an inventory, not a complete DDL specification. Defaults, keys, column types and constraints
must match the existing database. `DEFAULT_SETTINGS` in `lib/db.ts` merges fallback values when
settings are read; it does not create tables or seed ICP profiles. Money is stored in cents.

## Commands

| Command | Behavior |
| --- | --- |
| `npm run dev` | Development server on port 3100 |
| `npm run build` | Production build and TypeScript validation; DB connection is lazy |
| `npm run start` | Production server on port 3100; requires a prior build |
| `npm run lint` | Currently prompts for ESLint setup; no config/dependencies are committed |
| `npm run rules` | Evaluates stored performance and **inserts proposals** into `engine_actions`, then prints JSON |

**Rules evaluation is not a read-only dry run.** It does not call Meta, but writes
`executed=0` proposals into the configured database. Repeated runs can create duplicate proposals.
Use a disposable database for experiments.

## Engine skills

| Skill | Consumes | Responsibilities |
| --- | --- | --- |
| `/competitor-scan` | `competitor_scan` jobs | Fetch competitor ads, store observations, derive angles |
| `/process-jobs` | `generate_creative`, `regenerate` jobs | Write copy, generate visuals, update creatives and briefs |
| `/launch` | `launch_campaign` jobs | Create Meta entities and handle status changes |
| `/monitor` | Stored Meta IDs and metrics | Sync insights, run rules, execute proposals, update learnings |

Inspect the relevant `SKILL.md` and discover connector schemas in your engine session.
The skill files describe execution conventions; they do not implement transactional claiming,
idempotency, retry recovery, or enforced policy validation. Avoid concurrent engine runs against
the same queue until those controls are implemented.

Supported creative formats are square 1080×1080, portrait 1080×1350, vertical 1080×1920, and
landscape 1200×628. Copy counters use 125/40/30 characters for primary text/headline/description.
These are application guidelines; editing and approval APIs do not enforce them.
Feed/Story previews are local mockups, not authoritative Meta placement previews.

Long-running competitor ads are a research signal, **not proof of profitability**. No competitor
spend, revenue or conversion data is available from these observations.

## Guardrails and access

Defaults in `lib/db.ts` include:

| Setting | Default |
| --- | --- |
| Daily spend threshold | 5000 cents ($50 with USD defaults) |
| Minimum impressions / spend before action | 1000 impressions / 1000 cents |
| Target CPA / ROAS | 2500 cents / 2 |
| CTR floor | 0.6% |
| Scale step / fatigue frequency | 20% / 3 |

The rules propose pauses for high CPA, low CTR and fatigue, regeneration for fatigued creatives,
and budget increases for qualifying ads. `target_roas` is stored but is not used by the evaluator.

These controls have important limits:

- Launch budgets and job payloads are not validated against guardrails by the API.
- Scaling compares a single ad-set budget with the spend threshold; it does not enforce the sum
  of active budgets. Scale cooldowns are tracked per ad even though budgets belong to ad sets.
- The kill switch uses today's UTC spend from locally tracked ads. It requires a successful sync
  and engine execution; it is not a real-time account-wide spending cap.
- The evaluator can still produce scale proposals in a run containing a kill-switch proposal.
  The monitor skill instructs the engine to stop after executing the kill switch.
- PAUSED creation, compliance checks and mutation logging are engine instructions. The campaign
  API also accepts `activate_immediately`; the browser's normal launch form does not send it.

Middleware returns 503 for protected routes in production if `ADMIN_PASSWORD` is missing. With a
password configured, unauthenticated API requests return 401 and protected pages redirect to login.
Login sets a 30-day HttpOnly, SameSite=Lax cookie, Secure in production. Its value is a deterministic
SHA-256 digest of the password: all users share one token, with no individual roles, logout route,
session revocation or login throttling. Changing the password invalidates previous tokens.
Static assets and the Next.js image endpoint are outside the middleware gate.

## Hosting and media

`vercel.json` pins functions to `cle1`. Set `DATABASE_URL` and `ADMIN_PASSWORD` in the hosted
environment. Set `SUPABASE_PROJECT_ID` in the separate engine environment. Check that the database
and connection pool suit the deployment's region and instance count.

Generated local files under `public/assets/` are ignored by Git. They are neither uploaded to
Vercel nor durable shared storage. In particular, the stitched-video skill writes only a local
`asset_path`: upload the finished video to durable storage and store a reachable `asset_url`
before using it from a hosted app. Check provider URL expiry as well.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Production shows “Locked” / 503 | Set `ADMIN_PASSWORD` and restart/redeploy |
| APIs return 401 | Sign in again; password changes invalidate the cookie |
| Empty dashboard despite existing data | Inspect API status/server logs; client fallbacks hide errors as empty lists |
| `DATABASE_URL is not set` | Populate `.env.local` or the server environment |
| Missing relation / permission denied | Verify schema, role grants and role search path |
| Jobs remain pending | Invoke the corresponding skill in a connected Claude Code session |
| `npm run rules` cannot load local env | Use Node 22+ or export `DATABASE_URL` explicitly |
| Media works locally but not hosted | Publish to durable storage and use `asset_url` |
| Launch/save appears successful but nothing changes | Inspect the mutation response; several UI handlers do not check HTTP success |

## Audit and validation

See [AUDIT.md](AUDIT.md) for the full review, priorities and limitations. On the reviewed commit:

- Production build and included TypeScript checks passed.
- Local production auth checks confirmed 503 without configuration, 401 for unauthenticated APIs,
  redirects for protected pages, and successful password login.
- Lint exited with a setup prompt; no automated test suite or CI workflow is committed.
- `npm audit` reported 13 affected packages: 1 critical, 9 high, 3 moderate. Findings describe the
  freshly resolved dependency tree, not a verified exploit or the deployed dependency versions.
- No live database, connector execution, ad publishing, paid generation or deployed runtime was tested.

This documentation update does not fix the application issues.
