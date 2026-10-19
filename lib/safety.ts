import { createHash } from "node:crypto";
import { Database, getAllSettings, jsonValue } from "./db";
import { HttpError } from "./http";
import {
  accountDate,
  isoDate,
  assertBudget,
  httpsUrl,
  settingsSchema,
} from "./validation";
import { copyIssues, CTA_OPTIONS, FORMAT_SPECS } from "./format-specs";
export async function guardrails(db: Database) {
  return settingsSchema.parse(await getAllSettings(db));
}
export async function requireIcp(db: Database, id: number) {
  const [row] = await db`SELECT id FROM icp_profiles WHERE id=${id}`;
  if (!row) throw new HttpError(400, "Choose an existing audience profile");
}
export function requireCreative(c: Record<string, unknown>, approved = true) {
  if (approved && (c.status !== "approved" || c.approved_version !== c.version))
    throw new HttpError(400, "Creative approval is missing or outdated");
  const issues = copyIssues(c as Parameters<typeof copyIssues>[0]);
  if (
    issues.length ||
    !CTA_OPTIONS.includes(c.cta as (typeof CTA_OPTIONS)[number]) ||
    !Object.hasOwn(FORMAT_SPECS, String(c.format)) ||
    !["image", "video"].includes(String(c.media_type))
  )
    throw new HttpError(400, "Creative copy or format is invalid");
  if (
    !httpsUrl.safeParse(c.asset_url).success ||
    !httpsUrl.safeParse(c.landing_url).success
  )
    throw new HttpError(
      400,
      "Creative needs hosted HTTPS media and a landing URL",
    );
}
export async function allowance(
  db: Database,
  budget: number,
  excludeCampaign: number | null = null,
  requireSync = false,
) {
  const s = await guardrails(db);
  const [total] =
    await db`SELECT COALESCE(SUM(reserved_budget_cents),0)::float8 value FROM campaigns WHERE id <> COALESCE(${excludeCampaign},-1)`;
  const [sync] =
    await db`SELECT * FROM account_sync WHERE account_id=${s.fb_ad_account_id}`;
  const fresh =
    sync &&
    isoDate(sync.account_date) === accountDate(s.account_timezone) &&
    sync.timezone === s.account_timezone &&
    sync.currency === s.currency &&
    Date.now() - new Date(sync.synced_at).getTime() <=
      Number(s.max_sync_age_minutes) * 60000;
  if (requireSync && !fresh)
    throw new HttpError(
      409,
      "Sync full account spend and external budgets before activating or scaling",
    );
  if (fresh && sync.spend_cents >= Number(s.max_daily_spend_cents))
    throw new HttpError(409, "Daily spend threshold reached");
  try {
    assertBudget(
      budget,
      Number(total.value) + Number(sync?.external_daily_budget_cents ?? 0),
      Number(s.max_daily_spend_cents),
    );
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return s;
}
export async function idempotent<T>(
  db: Database,
  key: string | null,
  route: string,
  payload: unknown,
  run: () => Promise<T>,
): Promise<T> {
  if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new HttpError(
      400,
      "An Idempotency-Key (16–100 characters) is required",
    );
  const hash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  await db`INSERT INTO requests(key,route,body_hash) VALUES(${key},${route},${hash}) ON CONFLICT DO NOTHING`;
  const [request] =
    await db`SELECT * FROM requests WHERE key=${key} FOR UPDATE`;
  if (request.route !== route || request.body_hash !== hash)
    throw new HttpError(
      409,
      "Idempotency key already used for a different request",
    );
  if (request.response)
    return (
      typeof request.response === "string"
        ? JSON.parse(request.response)
        : request.response
    ) as T;
  const result = await run();
  await db`UPDATE requests SET response=${db.json(jsonValue(result))} WHERE key=${key}`;
  return result;
}
export async function safetyLock(db: Database) {
  await db`SELECT pg_advisory_xact_lock(310001)`;
}
