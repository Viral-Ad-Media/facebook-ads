---
name: process-jobs
description: Drain pending generate_creative/regenerate jobs — write ad copy and generate Higgsfield images/videos for each brief, saving results into the local ads database so they appear in the Ad Studio preview.
---

# Process generation jobs

You are the creative engine for the Facebook Ads Studio app in this project. Execute every pending `generate_creative` and `regenerate` job.

## Steps

1. **Read pending jobs** (project root is this skill's grandparent dir; DB is `data/ads.db`):
   ```bash
   sqlite3 -json data/ads.db "SELECT * FROM jobs WHERE status='pending' AND type IN ('generate_creative','regenerate') ORDER BY id"
   ```
   For each job, mark it running: `UPDATE jobs SET status='running' WHERE id=?`.

2. **Load the brief + ICP** (`payload.brief_id`; for `regenerate` jobs, look up the original creative's brief via `payload.creative_id`):
   ```bash
   sqlite3 -json data/ads.db "SELECT b.*, i.name icp_name, i.description icp_desc, i.pain_points, i.tone, i.interests FROM briefs b LEFT JOIN icp_profiles i ON i.id=b.icp_id WHERE b.id=?"
   ```
   Also read the top learnings — apply them to hooks and formats:
   ```bash
   sqlite3 -json data/ads.db "SELECT dimension, insight FROM learnings ORDER BY confidence DESC LIMIT 5"
   ```

3. **Write the copy yourself** for each variant × format. Rules:
   - `primary_text` ≤ 125 chars, `headline` ≤ 40 chars, `description` ≤ 30 chars (hard limits — count characters).
   - Voice = ICP `tone`; lead with the ICP's pain point; include the offer; each variant uses a distinctly different hook (record it in the `hook` column, 3–6 words, e.g. "time-saved angle", "social proof angle").
   - Pick a `cta` from: LEARN_MORE, SHOP_NOW, SIGN_UP, GET_OFFER, SUBSCRIBE, CONTACT_US, DOWNLOAD.

4. **Generate visuals with Higgsfield** (the connected Higgsfield MCP server):
   - Images: `generate_image`; Videos: `generate_video`. If unsure which model fits, call `models_explore(action:'recommend')` first.
   - One asset per variant × format. Match the format's aspect ratio exactly:
     - `feed_square` 1:1 (1080×1080) · `feed_portrait` 4:5 (1080×1350) · `story_vertical` 9:16 (1080×1920) · `landscape` 1.91:1 (1200×628)
   - Prompt = product + angle/hook + brief notes + "Facebook ad creative, scroll-stopping, no embedded text overlays, professional advertising photography/motion".
   - Download each finished asset into `public/assets/` named `creative-<brief_id>-<n>.<ext>` (curl the returned URL). Keep the hosted URL too.

5. **Insert creatives**:
   ```bash
   sqlite3 data/ads.db "INSERT INTO creatives (brief_id, media_type, format, asset_path, asset_url, primary_text, headline, description, cta, hook) VALUES (...)"
   ```
   `asset_path` is relative to `public/`, stored with a leading slash, e.g. `/assets/creative-3-1.png`.
   For long copy strings prefer a heredoc: `sqlite3 data/ads.db <<'SQL' ... SQL`.

6. **Finish each job**: `UPDATE jobs SET status='done', result=?, finished_at=datetime('now') WHERE id=?` (result = JSON list of creative ids). Set the brief `status='ready'`. On any failure, set job `status='failed'` with the error in `result` and continue with the next job.

7. **Report**: list what was generated per brief and tell the user the variants are ready to preview at http://localhost:3100/studio.

## Rules
- Never call Facebook tools from this skill — generation only.
- If Higgsfield generation fails or credits are exhausted, still save the copy-only creative rows (asset fields NULL) so the user can review copy, and say clearly that visuals are pending.
