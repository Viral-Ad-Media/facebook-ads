import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction, jsonValue } from "@/lib/db";
import { api, body, HttpError } from "@/lib/http";
import { requireEngine } from "@/lib/auth";
import { id, accountDate } from "@/lib/validation";
import {
  allowance,
  guardrails,
  requireCreative,
  safetyLock,
} from "@/lib/safety";
const worker = z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/);
const command = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("claim"),
      worker,
      types: z
        .array(
          z.enum([
            "launch_campaign",
            "generate_creative",
            "regenerate",
            "competitor_scan",
          ]),
        )
        .min(1)
        .max(4),
    })
    .strict(),
  z.object({ command: z.literal("heartbeat"), worker, job_id: id }).strict(),
  z
    .object({
      command: z.literal("job_operation"),
      worker,
      job_id: id,
      step: z
        .string()
        .regex(
          /^(campaign|adset|creative:[0-9]+|ad:[0-9]+|toggle|generation:[0-9]+):[a-z_]+$/,
        ),
    })
    .strict(),
  z
    .object({
      command: z.literal("finish_operation"),
      worker,
      key: z.string().max(200),
      result: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      command: z.literal("finish_job"),
      worker,
      job_id: id,
      result: z.record(z.string(), z.unknown()),
      failed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({ command: z.literal("action_operation"), worker, action_id: id })
    .strict(),
  z
    .object({
      command: z.literal("finish_action"),
      worker,
      action_id: id,
      result: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      command: z.literal("sync_account"),
      account_id: z.string().regex(/^(act_)?[0-9]+$/),
      account_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timezone: z.string(),
      currency: z.literal("USD"),
      spend_cents: z.number().int().nonnegative(),
      external_daily_budget_cents: z.number().int().nonnegative(),
    })
    .strict(),
]);
export const dynamic = "force-dynamic";
export const POST = api(async (req) => {
  requireEngine(req.headers.get("authorization"));
  const b = await body(req, command);
  const result = await transaction(async (db) => {
    if (b.command === "sync_account") {
      const s = await guardrails(db);
      if (
        b.account_id !== s.fb_ad_account_id ||
        b.timezone !== s.account_timezone ||
        b.account_date !== accountDate(s.account_timezone)
      )
        throw new HttpError(
          400,
          "Account, date and timezone must match settings",
        );
      await db`INSERT INTO account_sync(account_id,account_date,timezone,currency,spend_cents,external_daily_budget_cents) VALUES(${b.account_id},${b.account_date},${b.timezone},${b.currency},${b.spend_cents},${b.external_daily_budget_cents}) ON CONFLICT(account_id) DO UPDATE SET account_date=excluded.account_date,timezone=excluded.timezone,currency=excluded.currency,spend_cents=excluded.spend_cents,external_daily_budget_cents=excluded.external_daily_budget_cents,synced_at=now()`;
      return { ok: true };
    }
    if (b.command === "claim") {
      const jobs =
        await db`SELECT * FROM claim_job(${b.worker},${b.types}::text[])`;
      return { job: jobs[0] ?? null };
    }
    if (b.command === "heartbeat") {
      const rows =
        await db`UPDATE jobs SET lease_until=now()+interval '10 minutes' WHERE id=${b.job_id} AND claimed_by=${b.worker} AND status='running' AND lease_until>now() RETURNING id`;
      if (!rows.length) throw new HttpError(409, "Job lease lost");
      return { ok: true };
    }
    if (b.command === "finish_operation") {
      const rows =
        await db`UPDATE operations SET status='done',result=${db.json(jsonValue(b.result))},finished_at=now() WHERE key=${b.key} AND owner=${b.worker} AND status='in_flight' RETURNING key`;
      if (!rows.length)
        throw new HttpError(409, "Operation is not owned or already finished");
      return { ok: true };
    }
    if (b.command === "finish_job") {
      const [job] =
        await db`SELECT * FROM jobs WHERE id=${b.job_id} AND claimed_by=${b.worker} AND status='running' AND lease_until>now() FOR UPDATE`;
      if (!job) throw new HttpError(409, "Job lease lost");
      const [unresolved] =
        await db`SELECT COUNT(*)::int n FROM operations WHERE job_id=${b.job_id} AND status<>'done'`;
      if (unresolved.n && !b.failed)
        throw new HttpError(
          409,
          "Reconcile unfinished operations before completing job",
        );
      const status = b.failed
        ? unresolved.n
          ? "needs_review"
          : "failed"
        : "done";
      await db`UPDATE jobs SET status=${status},result=${db.json(jsonValue(b.result))},finished_at=now(),lease_until=NULL WHERE id=${b.job_id}`;
      return { ok: true, status };
    }
    await safetyLock(db);
    if (b.command === "job_operation") {
      const [job] =
        await db`SELECT * FROM jobs WHERE id=${b.job_id} AND claimed_by=${b.worker} AND status='running' AND lease_until>now() FOR UPDATE`;
      if (!job) throw new HttpError(409, "Job lease lost");
      const payload =
        typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
      if (job.type === "launch_campaign") {
        const [campaign] =
          await db`SELECT * FROM campaigns WHERE id=${payload.campaign_id} FOR UPDATE`;
        if (!campaign) throw new HttpError(400, "Campaign missing");
        const activate =
          payload.set_ad_status?.status === "active" ||
          payload.set_campaign_status?.status === "active";
        await allowance(
          db,
          campaign.reserved_budget_cents || campaign.daily_budget_cents,
          campaign.id,
          activate,
        );
        if (payload.creative_ids) {
          const rows =
            await db`SELECT c.*,b.landing_url FROM creatives c JOIN briefs b ON b.id=c.brief_id WHERE c.id IN ${db(payload.creative_ids)}`;
          if (rows.length !== payload.creative_ids.length)
            throw new HttpError(400, "Creative missing");
          for (const c of rows) {
            requireCreative(c, c.status !== "launched");
            if (
              !payload.creative_versions?.some(
                (v: { id: number; version: number }) =>
                  v.id === c.id && v.version === c.version,
              ) ||
              c.approved_version !== c.version
            )
              throw new HttpError(
                409,
                "Queued creative was edited; review and enqueue again",
              );
          }
        } else if (activate) {
          const rows =
            await db`SELECT cr.*,br.landing_url FROM ads a JOIN ad_sets s ON s.id=a.ad_set_id JOIN creatives cr ON cr.id=a.creative_id JOIN briefs br ON br.id=cr.brief_id WHERE s.campaign_id=${campaign.id} ${payload.set_ad_status ? db`AND a.id=${payload.set_ad_status.ad_id}` : db``}`;
          if (!rows.length) throw new HttpError(400, "No ads to activate");
          rows.forEach((c) => {
            requireCreative(c, false);
            if (c.approved_version !== c.version)
              throw new HttpError(409, "Creative approval expired");
          });
        }
      }
      const key = `job:${job.id}:${b.step}`;
      const [existing] = await db`SELECT * FROM operations WHERE key=${key}`;
      if (existing) {
        if (existing.status === "done")
          return { already_done: true, result: existing.result };
        throw new HttpError(
          409,
          "Operation previously started. Reconcile provider state; do not retry blindly.",
        );
      }
      await db`INSERT INTO operations(key,job_id,owner) VALUES(${key},${job.id},${b.worker})`;
      return {
        key,
        permit_expires_at: new Date(Date.now() + 60000).toISOString(),
      };
    }
    const [action] =
      await db`SELECT * FROM engine_actions WHERE id=${b.action_id} FOR UPDATE`;
    if (!action) throw new HttpError(404, "Action not found");
    const snapshot =
      typeof action.metrics_snapshot === "string"
        ? JSON.parse(action.metrics_snapshot)
        : action.metrics_snapshot;
    const key = `action:${action.id}`;
    if (b.command === "action_operation") {
      if (
        action.status !== "proposed" ||
        Date.now() - new Date(action.created_at).getTime() > 30 * 60000
      )
        throw new HttpError(409, "Action expired or already claimed");
      const [existing] = await db`SELECT key FROM operations WHERE key=${key}`;
      if (existing) throw new HttpError(409, "Reconcile existing operation");
      if (action.action === "scale_budget") {
        const [set] =
          await db`SELECT * FROM ad_sets WHERE id=${action.ad_set_id} FOR UPDATE`;
        if (
          !set ||
          set.daily_budget_cents !== snapshot.params?.current_budget_cents
        )
          throw new HttpError(409, "Budget changed; evaluate again");
        const [kill] =
          await db`SELECT id FROM engine_actions WHERE action='kill_switch' AND status IN ('proposed','running')`;
        if (kill) throw new HttpError(409, "Kill switch pending");
        const [recent] =
          await db`SELECT id FROM engine_actions WHERE action='scale_budget' AND ad_set_id=${set.id} AND executed=1 AND COALESCE(executed_at,created_at)>now()-interval '24 hours'`;
        if (recent)
          throw new HttpError(
            409,
            "Ad set was already scaled in the last 24 hours",
          );
        const s = await guardrails(db);
        const next = snapshot.params.new_budget_cents;
        const delta = next - set.daily_budget_cents;
        if (
          !Number.isSafeInteger(next) ||
          delta <= 0 ||
          next >
            Math.round(
              set.daily_budget_cents * (1 + Number(s.scale_step_pct) / 100),
            )
        )
          throw new HttpError(400, "Invalid scale amount");
        const [c] =
          await db`SELECT * FROM campaigns WHERE id=${set.campaign_id}`;
        if (c.status !== "active")
          throw new HttpError(409, "Campaign is no longer active");
        await allowance(db, c.reserved_budget_cents + delta, c.id, true);
        await db`UPDATE campaigns SET reserved_budget_cents=reserved_budget_cents+${delta} WHERE id=${c.id}`;
      }
      await db`INSERT INTO operations(key,action_id,owner) VALUES(${key},${action.id},${b.worker})`;
      await db`UPDATE engine_actions SET status='running' WHERE id=${action.id}`;
      return {
        key,
        action,
        snapshot,
        permit_expires_at: new Date(Date.now() + 60000).toISOString(),
      };
    }
    const [op] =
      await db`SELECT * FROM operations WHERE key=${key} AND owner=${b.worker} AND status='done'`;
    if (!op || action.status !== "running")
      throw new HttpError(
        409,
        "Record the successful provider operation before completing action",
      );
    if (action.action === "scale_budget") {
      await db`UPDATE ad_sets SET daily_budget_cents=${snapshot.params.new_budget_cents} WHERE id=${action.ad_set_id}`;
      await db`UPDATE campaigns SET daily_budget_cents=(SELECT SUM(daily_budget_cents) FROM ad_sets WHERE campaign_id=${action.campaign_id}) WHERE id=${action.campaign_id}`;
    }
    if (action.action === "pause")
      await db`UPDATE ads SET status='paused' WHERE id=${action.ad_id}`;
    if (action.action === "kill_switch") {
      await db`UPDATE ads SET status='paused' WHERE status='active'`;
      await db`UPDATE campaigns SET status='paused' WHERE status='active'`;
      await db`UPDATE engine_actions SET status='expired' WHERE action='scale_budget' AND status='proposed'`;
    }
    if (action.action === "regenerate_queued")
      await db`INSERT INTO jobs(type,payload,idempotency_key) VALUES('regenerate',${db.json({ creative_id: snapshot.params.creative_id })},${key}) ON CONFLICT DO NOTHING`;
    await db`UPDATE engine_actions SET executed=1,status='executed',executed_at=now() WHERE id=${action.id}`;
    return { ok: true };
  });
  return NextResponse.json(result);
});
