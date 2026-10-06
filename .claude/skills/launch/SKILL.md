---
name: launch
description: Execute pending launch_campaign jobs — create the campaign, ad set, creatives, and ads on Facebook (PAUSED) via the Facebook Ads connector, write the Facebook IDs back to the local database, and handle ad on/off toggle requests.
---

# Launch campaigns to Facebook

You are the publishing engine for the Facebook Ads Studio app. Execute every pending `launch_campaign` job using the **Facebook Ads connector** (`ads_*` MCP tools).

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

## Safety rules (non-negotiable)
- Everything is created with status **PAUSED**. Only activate from a separately claimed dashboard status-change job after a fresh full-account sync and successful gateway permit. Do not accept activate_immediately or activate from an ordinary launch job.
- **Pre-flight compliance check before creating anything on Facebook**: re-verify each creative against the compliance gate in the process-jobs skill (no income claims, no personal-attribute callouts, no sensational/deceptive framing, no fake UI, no brand logos, landing page matches the promise) and confirm every video has an audio stream. If a creative fails, skip it, flag it in the report, and launch the rest.
- Never set a budget above the `max_daily_spend_cents` guardrail in `settings`.
- On any Facebook error, call `ads_get_errors`, store the message in the job `result`, set campaign `status='error'`, and report it — don't retry blindly.

## Steps

**Database access:** hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

1. **Inspect pending jobs (claim through the gateway before doing work)**:
   ```sql
   SELECT * FROM fbads.jobs WHERE status='pending' AND type='launch_campaign' ORDER BY id
   ```
   Claim atomically through the gateway before working on it.

2. **Toggle-only jobs**: if `payload.set_ad_status` or `payload.set_campaign_status` exists, this is an on/off request from the dashboard:
   - Ad toggle: look up the ad's `fb_ad_id`, call `ads_activate_entity` (activate) or `ads_update_entity` (status PAUSED), update local `ads.status`.
   - Campaign toggle: same calls against the campaign's `fb_campaign_id`; update the local campaign row and cascade the status to its local ads rows.
   - Either way: insert an `engine_actions` row (`action='activate'|'pause'`, `reason='manual toggle from dashboard'`, `executed=1`), finish_job through the gateway, and skip the rest.

3. **Resolve account + page**: read `fb_ad_account_id` / `fb_page_id` from `settings`. If blank, call `ads_get_ad_accounts` and `ads_get_ad_account_pages`, pick the obvious one (ask the user if several), and save back into `settings`.

4. **Load the local draft**: campaign row (`payload.campaign_id`), its ICP profile, and the creatives (`payload.creative_ids`) with their copy + assets.

5. **Create on Facebook** (discover exact parameter shapes from the tool schemas at call time — they are authoritative):
   1. `ads_create_campaign` — name, objective, status PAUSED, special_ad_categories as required.
   2. **Ad set** — build the targeting spec from the ICP (geo_locations from `geo`, age_min/age_max, genders, flexible interests from `interests`), daily_budget from the campaign row, optimization goal matching the objective (see `OBJECTIVES` in `lib/format-specs.ts`). If the connector has no dedicated ad-set tool, check whether `ads_create_ad` accepts an adset spec inline or use `ads_get_field_context` to find the right call.
   3. Per creative: `ads_create_creative` with page id, copy fields, CTA, landing URL, and the media. Prefer the hosted `asset_url`; if the tool requires an uploaded image hash / video id, upload first (see `ads_get_ad_images` / `ads_get_ad_videos` families) and store `fb_image_hash` / `fb_video_id` on the creative row.
   4. `ads_create_ad` linking ad set + creative, status PAUSED.
   5. `ads_get_ad_preview` for each ad; store the preview HTML/URL in `ads.fb_preview_html`.

6. **Reconcile immediately checkpointed entities** to `campaigns` (fb_campaign_id, status 'paused', launched_at), `ad_sets` (insert row with fb_adset_id, targeting_json as sent, budget), `ads` (insert rows with fb_ad_id, fb_creative_id, status 'paused'), and mark creatives `status='launched'`.

7. **Activate** only per the safety rules above (`ads_activate_entity` on the campaign/ads), then set local statuses to 'active'.

8. **Finish**: call finish_job through the gateway with the recorded IDs. Report a summary — campaign name, FB campaign ID, budget/day, audience summary, number of ads — and remind the user the campaign is paused until activated (dashboard: http://localhost:3100 or the deployed Vercel URL).
