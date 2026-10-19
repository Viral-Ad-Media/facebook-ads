import { NextResponse } from "next/server";
import { z } from "zod";
import { sql, transaction } from "@/lib/db";
import { api, body, HttpError } from "@/lib/http";
import { toggleSchema } from "@/lib/validation";
import { allowance, idempotent, safetyLock } from "@/lib/safety";
export const dynamic = "force-dynamic";
export const GET = api(async (req) => {
  const status = req.nextUrl.searchParams.get("status");
  if (status)
    z.enum(["pending", "running", "done", "failed", "needs_review"]).parse(
      status,
    );
  const jobs =
    await sql`SELECT * FROM jobs WHERE true ${status ? sql`AND status=${status}` : sql``} ORDER BY id DESC LIMIT 50`;
  const [pending] =
    await sql`SELECT COUNT(*)::int c FROM jobs WHERE status='pending'`;
  return NextResponse.json({ jobs, pending: pending.c });
});
export const POST = api(async (req) => {
  const b = await body(req, toggleSchema);
  const result = await transaction((db) =>
    idempotent(
      db,
      req.headers.get("idempotency-key"),
      "toggle",
      b,
      async () => {
        await safetyLock(db);
        const [c] =
          await db`SELECT * FROM campaigns WHERE id=${b.payload.campaign_id} FOR UPDATE`;
        if (!c?.fb_campaign_id)
          throw new HttpError(400, "Campaign is not published");
        if (b.payload.set_ad_status) {
          const [ad] =
            await db`SELECT a.* FROM ads a JOIN ad_sets s ON s.id=a.ad_set_id WHERE a.id=${b.payload.set_ad_status.ad_id} AND s.campaign_id=${c.id}`;
          if (!ad?.fb_ad_id)
            throw new HttpError(400, "Ad does not belong to campaign");
        }
        const status =
          b.payload.set_ad_status?.status ??
          b.payload.set_campaign_status!.status;
        if (status === "active") {
          await allowance(
            db,
            c.reserved_budget_cents || c.daily_budget_cents,
            c.id,
            true,
          );
        }
        const [row] =
          await db`INSERT INTO jobs(type,payload,idempotency_key) VALUES(${b.type},${db.json(b.payload)},${req.headers.get("idempotency-key")!}) RETURNING id`;
        return { id: row.id };
      },
    ),
  );
  return NextResponse.json(result, { status: 201 });
});
