---
name: process-jobs
description: Drain pending generate_creative/regenerate jobs — write ad copy and generate Higgsfield images/videos for each brief, saving results into the local ads database so they appear in the Ad Studio preview.
---

# Process generation jobs

You are the creative engine for the Facebook Ads Studio app in this project. Execute every pending `generate_creative` and `regenerate` job.

## Steps

**Database access:** the DB is hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

1. **Read pending jobs**:
   ```sql
   SELECT * FROM fbads.jobs WHERE status='pending' AND type IN ('generate_creative','regenerate') ORDER BY id
   ```
   For each job, mark it running: `UPDATE fbads.jobs SET status='running' WHERE id=?`.

2. **Load the brief + ICP** (`payload.brief_id`; for `regenerate` jobs, look up the original creative's brief via `payload.creative_id`):
   ```sql
   SELECT b.*, i.name icp_name, i.description icp_desc, i.pain_points, i.tone, i.interests
   FROM fbads.briefs b LEFT JOIN fbads.icp_profiles i ON i.id=b.icp_id WHERE b.id=?
   ```
   Also read the top learnings — apply them to hooks and formats:
   ```sql
   SELECT dimension, insight FROM fbads.learnings ORDER BY confidence DESC LIMIT 5
   ```

3. **Write the copy yourself** for each variant × format. Rules:
   - `primary_text` ≤ 125 chars, `headline` ≤ 40 chars, `description` ≤ 30 chars (hard limits — count characters).
   - Voice = ICP `tone`; lead with the ICP's pain point; include the offer; each variant uses a distinctly different hook (record it in the `hook` column, 3–6 words, e.g. "time-saved angle", "social proof angle").
   - Pick a `cta` from: LEARN_MORE, SHOP_NOW, SIGN_UP, GET_OFFER, SUBSCRIBE, CONTACT_US, DOWNLOAD.

4. **Generate visuals — Higgsfield first, kie-ai as the standing fallback**:
   - **Primary (Higgsfield MCP)**: images via `generate_image`, videos via `generate_video`. If unsure which model fits, call `models_explore(action:'recommend')` first.
   - **Fallback (kie-ai MCP)** — use automatically whenever Higgsfield fails, is out of credits, or lacks a suitable model. Do not stop to ask; the user has standing approval for kie-ai as the alternative.
     - Images: `nano_banana_image` (default), `flux2_image` or `gpt_image_2` if a prompt needs a different look.
     - Videos: `kling_video` or `veo3_generate_video` (default kling for ad motion), `hailuo_video` as backup.
     - kie-ai jobs are async: capture the task id, then `wait_for_task` (or poll `get_task_status`) until it returns the hosted media URL.
   - One asset per variant × format. Match the format's aspect ratio exactly:
     - `feed_square` 1:1 (1080×1080) · `feed_portrait` 4:5 (1080×1350) · `story_vertical` 9:16 (1080×1920) · `landscape` 1.91:1 (1200×628)
   - Prompt = product + angle/hook + brief notes + "Facebook ad creative, scroll-stopping, no embedded text overlays, professional advertising photography/motion".
   - **`asset_url` (the hosted Higgsfield URL) is the primary asset reference** — the deployed app renders from it. Optionally also download a local backup into `public/assets/` named `creative-<brief_id>-<n>.<ext>` and store it as `asset_path` (leading slash, e.g. `/assets/creative-3-1.png`).

5. **Insert creatives**:
   ```sql
   INSERT INTO fbads.creatives (brief_id, media_type, format, asset_path, asset_url, primary_text, headline, description, cta, hook) VALUES (...)
   ```

6. **Finish each job**: `UPDATE fbads.jobs SET status='done', result=?, finished_at=now() WHERE id=?` (result = JSON list of creative ids). Set the brief `status='ready'`. On any failure, set job `status='failed'` with the error in `result` and continue with the next job.

7. **Report**: list what was generated per brief and tell the user the variants are ready to preview in the Studio (locally http://localhost:3100/studio, or the deployed Vercel URL).

## Rules
- Never call Facebook tools from this skill — generation only.
- If Higgsfield generation fails or credits are exhausted, still save the copy-only creative rows (asset fields NULL) so the user can review copy, and say clearly that visuals are pending.
