# Repository audit — October 6, 2026

Reviewed commit: `f7a193794bcd0cf0bae30b7b20e601aa3dce960b` (main).
Scope: all 49 tracked files, including the web pages/components, 11 API routes, middleware,
database client, rules evaluator, engine instructions, dependency manifest and deployment config.
This is a source review with local build/auth/dependency checks, not a production penetration test.

**Assessment:** the UI and queue architecture are understandable and the production build works.
The repository is not ready for unattended spend-affecting execution without the controls below.
This change updates documentation only; all application findings remain open.

## Validation

| Check | Result |
| --- | --- |
| Dependency setup | `npm install --ignore-scripts --package-lock=false` succeeded; optional ffmpeg download was intentionally not executed |
| Production build | `npm run build` passed, including TypeScript validation |
| Lint | `CI=1 npm run lint` exited 1 and prompted to configure ESLint |
| Dependency audit | `npm audit --json`: 13 affected packages (1 critical, 9 high, 3 moderate) |
| Production, no admin password | Dashboard and jobs API returned 503; login page returned 200 |
| Production, configured password | Dashboard redirected with 307; unauthenticated jobs API returned 401 |
| Password login | Wrong password returned 401 without cookie; correct password returned 200 with cookie; authenticated dashboard returned 200 |
| Database/rules | Not executed: no provisioned test database or connection credentials |
| External integrations | Not executed: no Meta mutations, paid media generation or connector jobs |
| Hosted deployment | Not inspected |

Environment: Node 24.19.0, npm 11.9.0. Fresh installation resolved Next.js 14.2.35 and Recharts
2.15.4. No lockfile exists, so these results do not establish the deployed versions. Package advisory
counts include build tooling and transitive dependencies; applicability depends on runtime and usage.

## Findings

### F01 — High: launch safety depends on client controls and engine instructions

Evidence: [campaign API](app/api/campaigns/route.ts), POST lines 32–44;
[job API](app/api/jobs/route.ts), POST; [creative API](app/api/creatives/route.ts), PATCH;
[launch skill](.claude/skills/launch/SKILL.md).

The campaign endpoint accepts arbitrary budget, objective, creative IDs and
`activate_immediately` without checking guardrails, approval status, media, destination URL or
ICP existence. The generic jobs endpoint accepts arbitrary type/payload, including activation
requests. Creative status can be changed without validating required fields or copy.

An authenticated caller can bypass every launch-form restriction and queue an over-budget or
unreviewed campaign. This is a missing server-side invariant, not a demonstrated unauthenticated
Meta launch: actual publishing still requires an engine to process the job.

Fix: validate typed payloads and allowed job types; load referenced creatives/ICP and reject invalid
or unapproved assets; enforce budgets and explicit activation intent server-side. Repeat these
checks immediately before executing a Meta mutation. Keep approval tied to the reviewed version.

### F02 — High: budget scaling and spend threshold are not account-wide controls

Evidence: [evaluator](scripts/evaluate-rules.ts), lines 123–145; lines 39–53;
[monitor skill](.claude/skills/monitor/SKILL.md), sections 1 and 3.

Scaling runs per ad, but changes the shared ad-set budget. Two qualifying ads in one ad set can
produce two proposals, and an executed action on one ad does not block another ad from scaling
that same set later within 24 hours. The ceiling compares one new ad-set budget to the configured
threshold, without adding other active budgets.

The kill switch sums only rows stored for locally known ads using a UTC date. It cannot cover
untracked campaigns, stale insights, or spend incurred between monitoring runs. A kill-switch
proposal also does not stop the evaluator from producing scale proposals; stopping depends on
the monitor following its instructions.

Fix: evaluate unique ad sets, use ad-set-level cooldowns and idempotency, enforce aggregate active
budget limits at launch/activation/scale time, reconcile full account spend with the account
timezone and require fresh data. Return only kill-switch actions when tripped. Retain independent
Meta spending controls; a polling engine is not a hard real-time spend cap.

### F03 — High: zero-conversion sales/leads ads can be scaled as traffic winners

Evidence: [evaluator](scripts/evaluate-rules.ts), lines 56–72 and 123–125.

The evaluator does not load the campaign objective. `cpa === null` means zero conversions,
but the `strongCtr` branch treats that as a traffic campaign without conversion tracking.
A sales ad with adequate impressions/spend and high CTR can therefore get a budget increase
despite delivering no conversions. There is no separate spend-with-zero-conversions stop rule.

Fix: make rules objective-aware; distinguish missing tracking from observed zero conversions.
Define a reviewed spend threshold for stopping zero-conversion sales/leads ads and require actual
conversion evidence before scaling those objectives.

### F04 — High: fresh installs resolve dependencies with security advisories

Evidence: [package.json](package.json), audit output from October 6, 2026.

The audit reports Next.js as critical, along with high findings affecting PostCSS, Tailwind and
transitive packages. Critical Next.js advisories include
[AVIF image optimization RCE](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)
and [Windows-hosted RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36).
The Windows-specific finding does not demonstrate risk on a Linux/Vercel deployment.
Several other advisories require features absent from this code; do not equate package presence
with proven exploitability.

The configuration permits arbitrary HTTPS image hosts and middleware excludes the image endpoint,
which warrants explicit review of image optimization even though current components use raw images.

Fix: migrate to a supported patched framework/toolchain, test compatibility, narrow/remove unused
image optimization configuration, commit a lockfile, and run reproducible dependency audits in CI.
Do not apply forced major upgrades without reviewing framework and Tailwind migration changes.

### F05 — High: queue claims and external effects lack enforced idempotency

Evidence: all four [.claude/skills](.claude/skills/) files; especially launch steps 1, 5 and 6.

Each skill selects pending jobs then marks them running in a separate step. The instructions do
not require an atomic conditional claim or `FOR UPDATE SKIP LOCKED`. Multiple engine sessions
can select the same work. Launch writes Meta IDs back after creating entities; interruption after
creation but before persistence can leave partial remote entities without durable recovery state.

Fix: implement atomic claims with leases and ownership; persist per-step remote IDs immediately;
use deterministic operation keys and reconciliation before retrying. Add stale-job recovery and
explicit retry rules for partially created campaigns/media.

### F06 — Medium: draft creation and job enqueue are not atomic

Evidence: [brief API](app/api/briefs/route.ts), POST;
[campaign API](app/api/campaigns/route.ts), POST.

Both routes insert a draft and then insert its job outside a transaction. If enqueueing fails,
a brief stays generating or a campaign stays launching with no pending engine work. Browser
retries can create duplicates because there is no request idempotency key.

Fix: wrap each pair in a database transaction and use idempotency keys for repeated requests.
Report enqueue failures explicitly to the UI.

### F07 — Medium: settings and other input can disable or corrupt rule behavior

Evidence: [settings API](app/api/settings/route.ts), PUT;
[db settings](lib/db.ts), lines 57–66; [evaluator](scripts/evaluate-rules.ts), lines 30–37;
[ICP API](app/api/icp/route.ts); [brief API](app/api/briefs/route.ts).

Settings accepts any key/value. Numeric conversion can produce NaN, negative values or implausible
thresholds; comparisons with NaN silently stop relevant checks from matching. ICP age ranges,
country values, brief formats/counts and payload shapes also lack typed validation.
Malformed JSON/type mismatches generally become server errors rather than useful 400 responses.

Fix: allowlist settings and validate finite numeric ranges, integer cents, enumerations, IDs and
string lengths. Update multi-key settings transactionally and validate configuration again in
the evaluator before it proposes actions.

### F08 — Medium: authentication lacks abuse controls and individual sessions

Evidence: [login API](app/api/login/route.ts), [middleware](middleware.ts).

The public login route has no throttling. Cookie authentication uses an unsalted deterministic
SHA-256 password digest as the shared bearer token. Anyone holding that cookie can replay it;
there are no individual users, roles, logout endpoint or server-side session revocation.
A leaked digest also permits offline guessing of a weak shared password.

Positive controls: production fails closed without a password; the cookie is HttpOnly,
SameSite=Lax and Secure in production; rotating the password invalidates old tokens.

Fix: add login throttling and per-user authentication with random expiring sessions, revocation
and logout. For a temporary shared gate, use a high-entropy secret and document its limitations.
No authentication bypass was demonstrated in local checks.

### F09 — Medium: mutations report success without checking HTTP results

Evidence: [launch](app/launch/page.tsx), `launch`;
[settings](app/settings/page.tsx), `saveSettings/saveIcp`;
[studio](app/studio/page.tsx), `createBrief/updateSelected`;
[competitors](app/competitors/page.tsx), mutation handlers;
[dashboard](app/page.tsx), toggle handlers; [client helper](lib/client.ts).

Fetch resolves normally for 401/500 responses. These handlers do not check `res.ok`: launch can
show “queued,” settings can show “Saved,” and studio can clear a brief after a rejected request.
The GET helper maps authorization/database failures to empty arrays, concealing outages as
empty states.

Fix: use a shared mutation helper with HTTP/error parsing, pending state and visible failures.
Preserve input until success and distinguish empty, loading, unauthorized and error states.

### F10 — Medium: copy autosave races with typing and polling

Evidence: [studio](app/studio/page.tsx), lines 85–98 and 116–127.

Each keystroke sends an independent PATCH. Concurrent requests can complete out of order and
persist older text last. The five-second refresh replaces the selected creative with server state,
which may overwrite edits still in flight. Save failure does not roll back or expose an error.

Fix: debounce and serialize updates per creative, preserve dirty fields during polling, and use
row versions or update timestamps to reject stale writes.

### F11 — Medium: fresh deployment cannot reproduce its database and media

Evidence: [db client](lib/db.ts), [.env.example](.env.example),
[CLAUDE.md](CLAUDE.md), [.gitignore](.gitignore),
[process-jobs skill](.claude/skills/process-jobs/SKILL.md), section 4b.

No DDL, migrations, app-role grants or seed scripts are committed. The app assumes an external
schema and role search path. Database constraints/permissions described in instructions cannot
be established from the source alone. The old README's SQLite auto-create instructions were wrong.

Stitched video generation writes ignored local `public/assets` files with no hosted URL. Such
media will not exist in a separate Vercel deployment, producing broken previews or inaccessible
launch assets. Provider URLs may also expire.

Fix: version schema/role provisioning and seeds; use durable object storage for every finished
creative and store permanent asset references. Test a clean setup from an empty database.

### F12 — Medium: rules use stale/lifetime data and repeat proposal writes

Evidence: [evaluator](scripts/evaluate-rules.ts), lines 65–69, 98–105 and 149–158.

Rule aggregates span all recorded days. Average daily frequency is not equivalent to frequency
over the whole period, and older results can hide recent deterioration. The three-row CTR check
does not verify consecutive dates and three measurements represent only two declining intervals.
Every run inserts new proposals, including duplicates of unexecuted prior proposals.
`target_roas` exists in settings but is never read by the evaluator.

Fix: define recent windows and data freshness requirements, fetch period reach/frequency where
needed, check calendar continuity, deduplicate proposals, and either implement ROAS evaluation
or remove its misleading control.

### F13 — Medium: query volume grows with the entire campaign history

Evidence: [campaign API](app/api/campaigns/route.ts), lines 6–27;
[metrics API](app/api/metrics/route.ts);
[brief/creative APIs](app/api/briefs/route.ts);
[dashboard polling](app/page.tsx).

Campaigns are loaded without pagination, with sequential queries for each campaign, ad set and
ad. One request requires roughly 1 + campaign count + ad-set count + ad count queries. Dashboard
polling repeats this every ten seconds; historical metric aggregation is also unbounded.
This adds latency and connection load as history grows.

Fix: batch joins/aggregations, paginate entities, add date filters and indexes verified against
real query plans, and pause/back off polling when pages are hidden or APIs fail.

### F14 — Medium: automated quality gates are absent

Evidence: [package.json](package.json), repository file inventory.

There is no lockfile, test suite, test command, ESLint config/dependencies or GitHub Actions
workflow. The build passes but does not prove lint correctness: standalone lint stops at setup.
The highest-risk validation, queue, budget and optimization behaviors have no regression tests.

Fix: add reproducible installs, noninteractive lint/type/build checks and focused tests around
budget limits, objective-aware decisions, queue claims, auth and rejected API/UI mutations.

### F15 — Low: preview and layout claims exceed implementation

Evidence: [AdPreview](components/AdPreview.tsx), `FeedPreview`;
[Nav](components/Nav.tsx); [Onboarding](components/Onboarding.tsx);
[competitors page](app/competitors/page.tsx);
[competitor scan skill](.claude/skills/competitor-scan/SKILL.md).

Landscape assets use the feed preview's square ratio. The fixed-width sidebar/preview and
right-anchored tour card lack small-screen handling. Competitor longevity is described as proof
of profit, despite no profitability data. Copy counters are guidance, not hard API enforcement.
Some UI/engine documentation still calls the hosted database “local.”

Fix: correct aspect ratios, provide responsive navigation/tour bounds and keyboard/focus handling,
and describe long-running ads as observational research rather than verified results. Align
remaining UI and engine documentation with hosted Postgres.

## Recommended implementation order

1. Upgrade vulnerable dependencies and establish reproducible builds.
2. Enforce API/engine input validation, approved creative checks and spend limits.
3. Correct objective-aware optimization and ad-set/account-wide budget logic.
4. Add transactional enqueueing, atomic job claims, idempotency and recovery.
5. Improve sessions, mutation errors, autosave and observability.
6. Commit database provisioning, durable media handling and focused CI tests.
7. Address query scaling, responsive layouts and remaining copy inaccuracies.

## Review limits and positive observations

SQL queries use parameterized postgres templates; the creative update explicitly allowlists
column names. No SQL-injection finding was established. DB initialization is lazy, allowing the
production build without credentials. Environment files and generated assets are ignored by Git.
Current empty-state HTML strings are static developer content; the HTML renderer alone is not
evidence of an exploitable stored XSS.

No claims are made about deployed database privileges, indexes, constraints, secrets in historical
commits, connector availability, Meta acceptance, real campaign results or production exploitability.
Those need separate environment-specific checks. No real spending or publication occurred.
