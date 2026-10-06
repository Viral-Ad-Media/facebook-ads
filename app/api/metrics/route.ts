import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { api } from "@/lib/http";
import { id } from "@/lib/validation";
export const dynamic = "force-dynamic";
export const GET = api(async (req) => {
  const campaign = req.nextUrl.searchParams.get("campaign_id");
  if (campaign) id.parse(Number(campaign));
  const days = z.coerce
    .number()
    .int()
    .min(1)
    .max(90)
    .parse(req.nextUrl.searchParams.get("days") ?? 30);
  const rows =
    await sql`SELECT m.date,SUM(m.impressions)::float8 impressions,SUM(m.clicks)::float8 clicks,SUM(m.spend_cents)::float8 spend_cents,SUM(m.conversions)::float8 conversions,CASE WHEN SUM(m.impressions)>0 THEN 100.0*SUM(m.clicks)/SUM(m.impressions) ELSE 0 END::float8 ctr,CASE WHEN SUM(m.conversions)>0 THEN SUM(m.spend_cents)/SUM(m.conversions) ELSE 0 END::float8 cpa_cents FROM metrics_daily m JOIN ads a ON a.id=m.ad_id JOIN ad_sets s ON s.id=a.ad_set_id WHERE m.date>=CURRENT_DATE-${days} ${campaign ? sql`AND s.campaign_id=${Number(campaign)}` : sql``} GROUP BY m.date ORDER BY m.date`;
  return NextResponse.json(rows);
});
