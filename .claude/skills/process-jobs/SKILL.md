---
name: process-jobs
description: Drain pending generate_creative/regenerate jobs — write ad copy and generate Higgsfield images/videos for each brief, saving results into the local ads database so they appear in the Ad Studio preview.
---

# Process generation jobs

You are the creative engine for the Facebook Ads Studio app in this project. Execute every pending `generate_creative` and `regenerate` job.

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

**Database access:** the DB is hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

1. **Inspect pending jobs (claim through the gateway before doing work)**:
   ```sql
   SELECT * FROM fbads.jobs WHERE status='pending' AND type IN ('generate_creative','regenerate') ORDER BY id
   ```
   Claim each job through the gateway; do not update its lease/status directly.

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

3b. **Meta ad-policy compliance gate (MANDATORY — run on every creative before insert)**. Competitor angles are inspiration, but many competitors run policy-violating copy; translate the angle into compliant form, never copy the violation. Reject/rewrite anything that fails:
   - **No income claims or guarantees**: no "$X/month", "make your first $5k", "passive income guaranteed". Compliant framing: skills/process outcomes ("learn the exact system", "build your store step by step"). Testimonial-style claims need real, verifiable results + "results not typical" context — default to avoiding them entirely.
   - **No personal-attribute callouts**: nothing that asserts or implies the viewer's financial status, age, race, health, or other traits ("Are you broke?", "Perfect for felons" ❌). Address the situation, not the person ("When the 9-5 math stops adding up" ✓).
   - **No sensational/deceptive framing**: no "hidden loophole", "secret they don't want you to know", fake "REPORT:" news framing, clickbait urgency, or artificial scarcity that isn't real.
   - **No fake UI in creatives**: no play buttons that don't play, no fake notification overlays, checkboxes, or platform UI mimicking Facebook. In-scene screens (a laptop showing a dashboard in a photo) are fine; overlay graphics that look interactive are not.
   - **Trademarks**: descriptive references ("sell on Amazon and Walmart") are fine; never use Amazon/Walmart/Meta logos in generated visuals or imply endorsement — add "no brand logos" to every image/video prompt.
   - **Visual standards**: no before/after money or body shots, no shocking/strobing content, minimal text baked into images (put copy in the ad fields, not the artwork).
   - **Landing-page match**: the promise in the ad must exist on `landing_url` — flag mismatches in your report.
   - Log a one-line compliance note per creative in the job `result` if anything was rewritten.

4. **Generate visuals — Higgsfield first, kie-ai as the standing fallback**:
   - **Primary (Higgsfield MCP)**: images via `generate_image`, videos via `generate_video`. If unsure which model fits, call `models_explore(action:'recommend')` first.
   - **Fallback (kie-ai MCP)** — use automatically whenever Higgsfield fails, is out of credits, or lacks a suitable model. Do not stop to ask; the user has standing approval for kie-ai as the alternative.
     - Images: `nano_banana_image` (default), `flux2_image` or `gpt_image_2` if a prompt needs a different look.
     - Videos: `kling_video` or `veo3_generate_video` (default kling for ad motion), `hailuo_video` as backup.
     - **Every video MUST ship with audio — no silent ads.** For single-clip videos pass `sound: true` to kling (native ambient/dialogue audio). If a clip comes back silent, add a voiceover or music bed before saving (see 4b step 5). Verify before insert: `ffmpeg -i file.mp4` must show an audio stream.
     - kie-ai jobs are async: capture the task id, then `wait_for_task` (or poll `get_task_status`) until it returns the hosted media URL.
   - One asset per variant × format. Match the format's aspect ratio exactly:
     - `feed_square` 1:1 (1080×1080) · `feed_portrait` 4:5 (1080×1350) · `story_vertical` 9:16 (1080×1920) · `landscape` 1.91:1 (1200×628)
   - Prompt = product + angle/hook + brief notes + "Facebook ad creative, scroll-stopping, no embedded text overlays, professional advertising photography/motion".
   - **`asset_url` (the hosted Higgsfield URL) is the primary asset reference** — the deployed app renders from it. Optionally also download a local backup into `public/assets/` named `creative-<brief_id>-<n>.<ext>` and store it as `asset_path` (leading slash, e.g. `/assets/creative-3-1.png`).

4b. **Long-form scripted videos (any length, consistent characters)** — when the brief calls for a narrative/UGC-style ad longer than one clip (~15s max per generation), build it scene by scene:
   1. **Write the script first**, broken into scenes of 5–10 seconds each. Name the main character(s).
   2. **Character sheet**: generate ONE reference portrait per character with `nano_banana_image` (9:16, distinctive features: hair, outfit, accessories — distinctiveness is what keeps consistency).
   3. **Generate each scene** with `kling_video`, passing the SAME character via `kling_elements`:
      `kling_elements: [{name: "<Name>", description: "<exact physical description>", element_input_urls: ["<reference image URL>"]}]`
      and refer to the character **by name in the prompt**. Required call shape: `multi_shots: true` + `multi_prompt: [{duration, prompt}]` (the API rejects calls without them). Keep lighting/location continuity in the prompt ("in the same home office…").
   4. **Stitch locally** with the project's ffmpeg (`node_modules/ffmpeg-static/ffmpeg` — installed as a dev dependency; always quote the path, the folder name has a space):
      ```bash
      printf "file 'scene1.mp4'\nfile 'scene2.mp4'\n" > list.txt
      "node_modules/ffmpeg-static/ffmpeg" -f concat -safe 0 -i list.txt -c:v libx264 -pix_fmt yuv420p -r 30 out.mp4
      ```
      (Re-encode rather than `-c copy` so mismatched clip encodings never break playback. Never pass `-an` — audio is required.)
   5. **Voiceover/audio (required, not optional)**: write narration matching the script beats, generate it with kie `elevenlabs_tts`, then mux:
      `ffmpeg -i out.mp4 -i vo.mp3 -c:v copy -map 0:v -map 1:a -shortest final.mp4`
      If scenes already carry kling native audio (`sound: true` per scene), the concat keeps it — voiceover can layer on top with `amix` if both are wanted. Final check before insert: the file must contain an audio stream.
   6. Save the stitched file to `public/assets/` and insert ONE creative row for it (media_type 'video'). Upload the finished file with `npm run upload-media -- <FILE>` and set the returned permanent HTTPS `asset_url`. Configure STORAGE_URL, STORAGE_BUCKET and STORAGE_SERVICE_KEY; the bucket must be public. Never ship local-only media to the hosted app.

5. **Insert creatives**:
   ```sql
   INSERT INTO fbads.creatives (brief_id, media_type, format, asset_path, asset_url, primary_text, headline, description, cta, hook) VALUES (...)
   ```

6. **Finish each job**: use finish_job through the engine gateway (result = JSON list of creative ids). Set the brief `status='ready'`. On failure, call finish_job with failed:true and the error. Reconcile unfinished external operations before retrying.

7. **Report**: list what was generated per brief and tell the user the variants are ready to preview in the Studio (locally http://localhost:3100/studio, or the deployed Vercel URL).

## Rules
- Never call Facebook tools from this skill — generation only.
- If Higgsfield generation fails or credits are exhausted, still save the copy-only creative rows (asset fields NULL) so the user can review copy, and say clearly that visuals are pending.
