import { NextResponse } from "next/server";
import { z } from "zod";
import { sql, transaction } from "@/lib/db";
import { api, body, HttpError } from "@/lib/http";
import { creativePatchSchema, pageParams, id } from "@/lib/validation";
import { requireCreative } from "@/lib/safety";
export const dynamic = "force-dynamic";
export const GET = api(async (req) => {
  const { limit, offset } = pageParams(req.nextUrl);
  const brief = req.nextUrl.searchParams.get("brief_id");
  const status = req.nextUrl.searchParams.get("status");
  if (brief) id.parse(Number(brief));
  if (status) z.enum(["generated", "approved", "launched"]).parse(status);
  return NextResponse.json(
    await sql`SELECT c.*,b.product,b.landing_url FROM creatives c JOIN briefs b ON b.id=c.brief_id WHERE true ${brief ? sql`AND c.brief_id=${Number(brief)}` : sql``} ${status ? sql`AND c.status=${status}` : sql``} ORDER BY c.id DESC LIMIT ${limit} OFFSET ${offset}`,
  );
});
export const PATCH = api(async (req) => {
  const b = await body(req, creativePatchSchema);
  const row = await transaction(async (db) => {
    const [current] =
      await db`SELECT c.*,b.landing_url FROM creatives c JOIN briefs b ON b.id=c.brief_id WHERE c.id=${b.id} FOR UPDATE OF c`;
    if (!current) throw new HttpError(404, "Creative not found");
    if (current.version !== b.version)
      throw new HttpError(409, "Creative changed. Refresh before saving.");
    if (current.status === "launched")
      throw new HttpError(409, "Duplicate a launched creative before editing");
    const { id: creativeId, version, ...patch } = b;
    void version;
    if (b.status === "approved" && Object.keys(patch).length > 1)
      throw new HttpError(400, "Save edits before approval");
    if (b.status === "approved")
      requireCreative({ ...current, ...patch }, false);
    const [updated] =
      await db`UPDATE creatives SET ${db(patch)} WHERE id=${creativeId} RETURNING *`;
    return { ...updated, landing_url: current.landing_url };
  });
  return NextResponse.json(row);
});
