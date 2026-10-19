import { z } from "zod";
import { CTA_OPTIONS, FORMAT_SPECS, OBJECTIVES } from "./format-specs";
export const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const httpsUrl = z
  .string()
  .max(2048)
  .url()
  .refine((v) => {
    const u = new URL(v);
    const h = u.hostname.toLowerCase();
    const privateHost =
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)/.test(
        h,
      ) || h.endsWith(".local");
    return (
      u.protocol === "https:" && !u.username && !u.password && !privateHost
    );
  }, "Use a public HTTPS URL without credentials");
const text = (max: number) => z.string().trim().max(max);
const commaList = (allowed: string[]) =>
  z.string().refine((v) => {
    const items = v.split(",");
    return (
      items.length > 0 &&
      new Set(items).size === items.length &&
      items.every((i) => allowed.includes(i))
    );
  }, "Invalid or duplicate choices");
export const briefSchema = z
  .object({
    product: text(200).min(1),
    offer: text(2000).default(""),
    angle: text(2000).default(""),
    landing_url: httpsUrl,
    icp_id: id,
    formats: commaList(Object.keys(FORMAT_SPECS)).default(
      "feed_square,story_vertical",
    ),
    media_types: commaList(["image", "video"]).default("image"),
    variant_count: z.number().int().min(1).max(6).default(2),
    notes: text(5000).default(""),
  })
  .strict();
export const campaignSchema = z
  .object({
    name: text(200).min(1),
    objective: z.enum(OBJECTIVES.map((o) => o.id)).default("OUTCOME_TRAFFIC"),
    daily_budget_cents: z.number().int().min(100).max(10000000),
    icp_id: id,
    creative_ids: z
      .array(id)
      .min(1)
      .max(50)
      .refine((v) => new Set(v).size === v.length, "Duplicate creatives"),
  })
  .strict();
export const creativePatchSchema = z
  .object({
    id,
    version: z.number().int().nonnegative(),
    primary_text: text(125).optional(),
    headline: text(40).optional(),
    description: text(30).optional(),
    hook: text(200).optional(),
    cta: z.enum(CTA_OPTIONS).optional(),
    status: z.enum(["generated", "approved"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 2, "Nothing to update");
export const icpSchema = z
  .object({
    name: text(200).min(1).default("New ICP"),
    description: text(2000).default(""),
    age_min: z.number().int().min(18).max(65).default(25),
    age_max: z.number().int().min(18).max(65).default(55),
    genders: z.enum(["all", "male", "female"]).default("all"),
    geo: z
      .string()
      .regex(/^[A-Z]{2}(,[A-Z]{2})*$/)
      .max(100)
      .default("US"),
    interests: text(2000).default(""),
    pain_points: text(2000).default(""),
    tone: text(1000).default("confident, direct"),
  })
  .strict()
  .refine(
    (v) => v.age_min <= v.age_max,
    "Minimum age must not exceed maximum age",
  );
export const icpUpdateSchema = icpSchema.safeExtend({ id });
export const scanSchema = z
  .object({
    query: text(200).min(1),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default("US"),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
const numeric = (min: number, max: number, integer = false) =>
  z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .refine(
      (v) =>
        Number.isFinite(Number(v)) &&
        Number(v) >= min &&
        Number(v) <= max &&
        (!integer || Number.isInteger(Number(v))),
      "Invalid numeric setting",
    );
export const settingsSchema = z
  .object({
    fb_ad_account_id: z.string().regex(/^(act_)?\d+$|^$/),
    fb_page_id: z.string().regex(/^\d*$/),
    currency: z.literal("USD"),
    account_timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone"),
    max_daily_spend_cents: numeric(100, 10000000, true),
    min_impressions_before_action: numeric(100, 1000000, true),
    min_spend_cents_before_action: numeric(100, 10000000, true),
    target_cpa_cents: numeric(100, 10000000, true),
    target_roas: numeric(0.1, 100),
    ctr_floor: numeric(0.01, 100),
    scale_step_pct: numeric(1, 20),
    fatigue_frequency: numeric(1, 100),
    lookback_days: numeric(3, 30, true),
    max_sync_age_minutes: numeric(1, 120, true),
  })
  .strict();
export const settingsPatchSchema = settingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No settings supplied");
export const toggleSchema = z
  .object({
    type: z.literal("launch_campaign"),
    payload: z
      .object({
        campaign_id: id,
        set_ad_status: z
          .object({ ad_id: id, status: z.enum(["active", "paused"]) })
          .strict()
          .optional(),
        set_campaign_status: z
          .object({ status: z.enum(["active", "paused"]) })
          .strict()
          .optional(),
      })
      .strict()
      .refine(
        (v) => !!v.set_ad_status !== !!v.set_campaign_status,
        "Choose exactly one status change",
      ),
  })
  .strict();
export function pageParams(url: URL) {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(url.searchParams.get("limit") ?? 20);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .parse(url.searchParams.get("offset") ?? 0);
  return { limit, offset };
}
export function assertBudget(budget: number, reserved: number, max: number) {
  if (
    !Number.isSafeInteger(budget) ||
    budget < 0 ||
    !Number.isFinite(reserved) ||
    reserved < 0 ||
    !Number.isFinite(max) ||
    budget + reserved > max
  )
    throw new Error("Budget exceeds the account's available daily allowance");
}
export function accountDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isoDate(value: unknown) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}
