import { NextResponse } from "next/server";
import { z } from "zod";
import { sql, transaction } from "@/lib/db";
import { api, body, HttpError } from "@/lib/http";
import { scanSchema, id, pageParams } from "@/lib/validation";
import { idempotent } from "@/lib/safety";
export const dynamic = "force-dynamic";
export const GET = api(async (req) => {
  const { limit, offset } = pageParams(req.nextUrl);
  const query = req.nextUrl.searchParams.get("query");
  if (query) z.string().max(200).parse(query);
  const ads =
    await sql`SELECT * FROM competitor_ads WHERE true ${query ? sql`AND query=${query}` : sql``} ORDER BY starred DESC,collected_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const queries =
    await sql`SELECT query,COUNT(*)::int c,MAX(collected_at) last FROM competitor_ads GROUP BY query ORDER BY last DESC LIMIT 100`;
  return NextResponse.json({ ads, queries });
});
export const POST = api(async (req) => {
  const b = await body(req, scanSchema);
  const result = await transaction((db) =>
    idempotent(db, req.headers.get("idempotency-key"), "scan", b, async () => {
      const [row] =
        await db`INSERT INTO jobs(type,payload,idempotency_key) VALUES('competitor_scan',${db.json(b)},${req.headers.get("idempotency-key")!}) RETURNING id`;
      return { job_id: row.id };
    }),
  );
  return NextResponse.json(result, { status: 201 });
});
export const PATCH = api(async (req) => {
  const b = await body(
    req,
    z.object({ id, starred: z.union([z.literal(0), z.literal(1)]) }).strict(),
  );
  const rows =
    await sql`UPDATE competitor_ads SET starred=${b.starred} WHERE id=${b.id} RETURNING id`;
  if (!rows.length) throw new HttpError(404, "Ad not found");
  return NextResponse.json({ ok: true });
});
export const DELETE = api(async (req) => {
  const raw = req.nextUrl.searchParams.get("id");
  const query = req.nextUrl.searchParams.get("query");
  if (!!raw === !!query) throw new HttpError(400, "Choose id or query");
  const rows = raw
    ? await sql`DELETE FROM competitor_ads WHERE id=${id.parse(Number(raw))} RETURNING id`
    : await sql`DELETE FROM competitor_ads WHERE query=${z.string().min(1).max(200).parse(query)} RETURNING id`;
  return NextResponse.json({ ok: true, deleted: rows.length });
});
