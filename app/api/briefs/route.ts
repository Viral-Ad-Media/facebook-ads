import { NextResponse } from "next/server";
import { sql, transaction } from "@/lib/db";
import { api, body } from "@/lib/http";
import { briefSchema, pageParams } from "@/lib/validation";
import { idempotent, requireIcp } from "@/lib/safety";
export const dynamic = "force-dynamic";
export const GET = api(async (req) => {
  const { limit, offset } = pageParams(req.nextUrl);
  const rows =
    await sql`SELECT b.*, i.name icp_name, (SELECT COUNT(*)::int FROM creatives c WHERE c.brief_id=b.id) creative_count FROM briefs b LEFT JOIN icp_profiles i ON i.id=b.icp_id ORDER BY b.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return NextResponse.json(rows);
});
export const POST = api(async (req) => {
  const b = await body(req, briefSchema);
  const result = await transaction((db) =>
    idempotent(
      db,
      req.headers.get("idempotency-key"),
      "briefs",
      b,
      async () => {
        await requireIcp(db, b.icp_id);
        const [row] = await db`INSERT INTO briefs ${db(b)} RETURNING id`;
        await db`INSERT INTO jobs(type,payload,idempotency_key) VALUES('generate_creative',${db.json({ brief_id: row.id })},${"brief:" + row.id})`;
        return { id: row.id };
      },
    ),
  );
  return NextResponse.json(result, { status: 201 });
});
