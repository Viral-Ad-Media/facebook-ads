import { NextResponse } from "next/server";
import { sql, transaction } from "@/lib/db";
import { api, body, HttpError } from "@/lib/http";
import { campaignSchema, pageParams } from "@/lib/validation";
import {
  allowance,
  idempotent,
  requireCreative,
  requireIcp,
  safetyLock,
} from "@/lib/safety";
export const dynamic = "force-dynamic";
export const GET = api(async (req) => {
  const { limit, offset } = pageParams(req.nextUrl);
  const campaigns =
    await sql`SELECT c.*,i.name icp_name FROM campaigns c LEFT JOIN icp_profiles i ON i.id=c.icp_id ORDER BY c.id DESC LIMIT ${limit} OFFSET ${offset}`;
  if (!campaigns.length) return NextResponse.json([]);
  const sets =
    await sql`SELECT * FROM ad_sets WHERE campaign_id IN ${sql(campaigns.map((c) => c.id))}`;
  const ads = sets.length
    ? await sql`SELECT a.*,cr.headline,cr.asset_path,cr.asset_url,cr.media_type,cr.format FROM ads a LEFT JOIN creatives cr ON cr.id=a.creative_id WHERE a.ad_set_id IN ${sql(sets.map((s) => s.id))}`
    : [];
  const totals = ads.length
    ? await sql`SELECT ad_id,SUM(impressions)::float8 impressions,SUM(clicks)::float8 clicks,SUM(spend_cents)::float8 spend_cents,SUM(conversions)::float8 conversions,CASE WHEN SUM(impressions)>0 THEN 100.0*SUM(clicks)/SUM(impressions) ELSE 0 END::float8 ctr FROM metrics_daily WHERE ad_id IN ${sql(ads.map((a) => a.id))} AND date>=CURRENT_DATE-30 GROUP BY ad_id`
    : [];
  return NextResponse.json(
    campaigns.map((c) => ({
      ...c,
      ad_sets: sets
        .filter((s) => s.campaign_id === c.id)
        .map((s) => ({
          ...s,
          ads: ads
            .filter((a) => a.ad_set_id === s.id)
            .map((a) => ({
              ...a,
              totals: totals.find((t) => t.ad_id === a.id) ?? {
                impressions: 0,
                clicks: 0,
                spend_cents: 0,
                conversions: 0,
                ctr: 0,
              },
            })),
        })),
    })),
  );
});
export const POST = api(async (req) => {
  const b = await body(req, campaignSchema);
  const result = await transaction((db) =>
    idempotent(
      db,
      req.headers.get("idempotency-key"),
      "campaigns",
      b,
      async () => {
        await safetyLock(db);
        await requireIcp(db, b.icp_id);
        await allowance(db, b.daily_budget_cents);
        const creatives =
          await db`SELECT c.*,b.landing_url FROM creatives c JOIN briefs b ON b.id=c.brief_id WHERE c.id IN ${db(b.creative_ids)} FOR UPDATE OF c`;
        if (creatives.length !== b.creative_ids.length)
          throw new HttpError(400, "Unknown creative");
        creatives.forEach((c) => requireCreative(c));
        const [row] =
          await db`INSERT INTO campaigns(name,objective,status,daily_budget_cents,reserved_budget_cents,icp_id) VALUES(${b.name},${b.objective},'launching',${b.daily_budget_cents},${b.daily_budget_cents},${b.icp_id}) RETURNING id`;
        await db`INSERT INTO jobs(type,payload,idempotency_key) VALUES('launch_campaign',${db.json({ campaign_id: row.id, creative_ids: b.creative_ids, creative_versions: creatives.map((c) => ({ id: c.id, version: c.version })), activate_immediately: false })},${"launch:" + row.id})`;
        return { id: row.id };
      },
    ),
  );
  return NextResponse.json(result, { status: 201 });
});
