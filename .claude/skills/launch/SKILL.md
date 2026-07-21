---
name: launch
description: Execute pending launch_campaign jobs — create the campaign, ad set, creatives, and ads on Facebook (PAUSED) via the Facebook Ads connector, write the Facebook IDs back to the local database, and handle ad on/off toggle requests.
---

# Launch campaigns to Facebook

You are the publishing engine for the Facebook Ads Studio app. Execute every pending `launch_campaign` job using the **Facebook Ads connector** (`ads_*` MCP tools).

## Safety rules (non-negotiable)
- Everything is created with status **PAUSED**. Only activate when the job payload has `activate_immediately: true`, the payload contains `set_ad_status`, or the user explicitly confirms in chat.
- **Pre-flight compliance check before creating anything on Facebook**: re-verify each creative against the compliance gate in the process-jobs skill (no income claims, no personal-attribute callouts, no sensational/deceptive framing, no fake UI, no brand logos, landing page matches the promise) and confirm every video has an audio stream. If a creative fails, skip it, flag it in the report, and launch the rest.
- Never set a budget above the `max_daily_spend_cents` guardrail in `settings`.
- On any Facebook error, call `ads_get_errors`, store the message in the job `result`, set campaign `status='error'`, and report it — don't retry blindly.

## Steps

**Database access:** hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

1. **Read pending jobs**:
   ```sql
   SELECT * FROM fbads.jobs WHERE status='pending' AND type='launch_campaign' ORDER BY id
   ```
   Mark each running before working on it.

2. **Toggle-only jobs**: if `payload.set_ad_status` or `payload.set_campaign_status` exists, this is an on/off request from the dashboard:
   - Ad toggle: look up the ad's `fb_ad_id`, call `ads_activate_entity` (activate) or `ads_update_entity` (status PAUSED), update local `ads.status`.
   - Campaign toggle: same calls against the campaign's `fb_campaign_id`; update the local campaign row and cascade the status to its local ads rows.
   - Either way: insert an `engine_actions` row (`action='activate'|'pause'`, `reason='manual toggle from dashboard'`, `executed=1`), mark the job done, and skip the rest.

3. **Resolve account + page**: read `fb_ad_account_id` / `fb_page_id` from `settings`. If blank, call `ads_get_ad_accounts` and `ads_get_ad_account_pages`, pick the obvious one (ask the user if several), and save back into `settings`.

4. **Load the local draft**: campaign row (`payload.campaign_id`), its ICP profile, and the creatives (`payload.creative_ids`) with their copy + assets.

5. **Create on Facebook** (discover exact parameter shapes from the tool schemas at call time — they are authoritative):
   1. `ads_create_campaign` — name, objective, status PAUSED, special_ad_categories as required.
   2. **Ad set** — build the targeting spec from the ICP (geo_locations from `geo`, age_min/age_max, genders, flexible interests from `interests`), daily_budget from the campaign row, optimization goal matching the objective (see `OBJECTIVES` in `lib/format-specs.ts`). If the connector has no dedicated ad-set tool, check whether `ads_create_ad` accepts an adset spec inline or use `ads_get_field_context` to find the right call.
   3. Per creative: `ads_create_creative` with page id, copy fields, CTA, landing URL, and the media. Prefer the hosted `asset_url`; if the tool requires an uploaded image hash / video id, upload first (see `ads_get_ad_images` / `ads_get_ad_videos` families) and store `fb_image_hash` / `fb_video_id` on the creative row.
   4. `ads_create_ad` linking ad set + creative, status PAUSED.
   5. `ads_get_ad_preview` for each ad; store the preview HTML/URL in `ads.fb_preview_html`.

6. **Write everything back** to `campaigns` (fb_campaign_id, status 'paused', launched_at), `ad_sets` (insert row with fb_adset_id, targeting_json as sent, budget), `ads` (insert rows with fb_ad_id, fb_creative_id, status 'paused'), and mark creatives `status='launched'`.

7. **Activate** only per the safety rules above (`ads_activate_entity` on the campaign/ads), then set local statuses to 'active'.

8. **Finish**: mark job done with a JSON result of created IDs. Report a summary — campaign name, FB campaign ID, budget/day, audience summary, number of ads — and remind the user the campaign is paused until activated (dashboard: http://localhost:3100 or the deployed Vercel URL).
