---
name: competitor-scan
description: Drain pending competitor_scan jobs — search the Meta Ads Library via the Facebook Ads connector for a brand/keyword, store competitors' running ads in the local database, and analyze what makes the long-running ones work.
---

# Competitor ad scan

You are the competitive-intelligence engine for the Facebook Ads Studio app. Execute every pending `competitor_scan` job.

## Required execution protocol

Use the authenticated engine gateway; never claim jobs or mark completion using ad-hoc SQL.
Set `ENGINE_BASE_URL` and `ENGINE_TOKEN` in `.env.local` on the engine machine. A worker ID is a
fresh UUID for this engine session. Commands use `npm run engine -- '<JSON>'`.

- Claim one job atomically: `{"command":"claim","worker":"<UUID>","types":["<TYPE>"]}`.
  Process only the returned job. An empty result means stop. Expired running jobs become
  `needs_review`; do not reset/retry them without reconciling all provider IDs and billing effects.
- Renew the lease before ten minutes: `{"command":"heartbeat","worker":"<UUID>","job_id":1}`.
  Stop immediately on lease loss. Heartbeat during provider polling and between steps.
- Before each paid generation or Meta mutation, request a checkpoint/permit:
  `{"command":"job_operation","worker":"<UUID>","job_id":1,"step":"<STEP>"}`.
  Valid steps include `campaign:create`, `adset:create`, `creative:1:create`, `ad:1:create`,
  `toggle:status`, `generation:1:generate`. Number slots deterministically across formats/variants.
  A returned `already_done` means use its recorded result and skip the provider call.
  A 409 means reconcile provider state; never call the provider again speculatively.
  Permits expire after 60 seconds: make exactly one intended provider call promptly.
- Immediately after success, persist every provider ID or task/asset URL using
  `{"command":"finish_operation","worker":"<UUID>","key":"<RETURNED_KEY>","result":{...}}`.
  For async generation, persist the task ID before polling; resume polling the same task.
  A conclusive primary generation failure may be checkpointed as failed and followed by a
  distinct deterministic `generation:<SLOT>:fallback` operation; ambiguous failures require review.
  Save Meta IDs to local campaign/ad-set/ad rows immediately after their operation checkpoint,
  never only at the end. Recover rows from recorded results without recreating remote entities.
- On ambiguous timeout/crash, leave the operation in-flight and flag the job for reconciliation.
  Do not release its spend reservation. Confirm Meta/provider state before operator recovery.
- Complete with `{"command":"finish_job","worker":"<UUID>","job_id":1,"result":{...}}`.
  On failure add `"failed":true`. Unresolved operations produce `needs_review`.

Generation rows must use a unique `generation_key` such as `job:<ID>:slot:<N>` and
`INSERT ... ON CONFLICT (generation_key) WHERE generation_key IS NOT NULL DO NOTHING`.
Do not call a provider for a slot with an existing operation or creative. Copy-only failures may
be stored generated, but they cannot be approved or launched until hosted media is attached.

Never edit or activate an outdated approved version. Gateway preflight validates copy, URLs,
creative version and the aggregate budget reservation. All new campaigns stay PAUSED; the
API does not accept immediate activation. Explicit dashboard status requests are separate jobs.
Never bypass a gateway refusal with direct SQL or a connector call.

## Steps

**Database access:** hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

1. **Inspect pending jobs (claim through the gateway before doing work)**:
   ```sql
   SELECT * FROM fbads.jobs WHERE status='pending' AND type='competitor_scan' ORDER BY id
   ```
   Claim atomically through the gateway before working on it. Payload: `{ query, country, limit }`.

2. **Search the Meta Ads Library** — two methods, prefer the second when possible:
   - **Keyword API**: connector tool `ads_library_search` (search term = `query`, active only). Warning: it OR-matches tokens and returns newest-first, so generic queries drown in noise and long-runners rarely surface. Only store results whose page is genuinely relevant.
   - **Page scan via the Ads Library web UI (much better)** — works whenever the query is a specific person/brand or a Facebook page URL:
     1. Open `https://web.facebook.com/<handle>` in the in-app browser and extract the numeric page id from the HTML (`javascript_tool`, regex `"delegate_page":\{"id":"(\d+)"` or `"page_id":"(\d+)"`). The tab title gives the exact page display name.
     2. Navigate to `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=<PAGE_ID>` (public, no login) and `get_page_text`. This returns **every active ad with full body copy, start dates ("Started running on …"), variant counts, video lengths, destination domains, and CTAs** — far richer than the API. Scroll/paginate for more.
     3. Dedupe by creative concept; store one row per distinct creative with the full body text.

3. **Store each result** in `fbads.competitor_ads` (`INSERT ... ON CONFLICT (library_id) DO NOTHING` — `library_id` is unique):
   - `query`, `page_name`, `library_id`, `body`, `headline`, `cta`
   - `media_type` (image/video/carousel), `media_url` (first image/video thumbnail if exposed), `snapshot_url` (the Ads Library link)
   - `started_at` = ad delivery start date (this is the **winning signal** — ad longevity is an observational research signal, not proof of profitability)
   - `platforms` = comma-joined publisher platforms

4. **Analyze the winners**: for ads running ≥ 60 days (or the longest-running handful), write one sentence into the `analysis` column naming the hook type, angle, offer structure, and format choice (e.g. "Problem-agitate hook with UGC-style video and a free-trial offer — social proof in the first line"). Base this on the ad text you stored; do not invent details.

5. **Cross-query patterns → learnings**: if a clear pattern shows up across the scanned set (e.g. every long-runner is a video, or all lead with a discount), upsert a `learnings` row with `dimension` = hook/format/offer, the insight, `evidence` = "Ads Library scan: <query>", confidence ~0.4 (observational, not our own data).

6. **Finish each job**: use finish_job through the engine gateway (result = count stored). On tool failure, finish through the gateway with failed:true and report. Never automatically retry ambiguous provider mutations.

7. **Report**: how many ads stored per query, the top 3 longest-running with their angle analysis, and point the user to the Competitors page (locally http://localhost:3100/competitors or the deployed Vercel URL) — the "Use as inspiration" button pre-fills a new brief from any card.

## Rules
- Read-only against Facebook — this skill never creates or modifies ads.
- Store competitor copy verbatim for analysis, but when the user later builds ads from it, take the *angle*, never copy the text.
