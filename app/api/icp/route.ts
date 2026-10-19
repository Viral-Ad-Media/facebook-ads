import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { api, body, HttpError } from "@/lib/http";
import { icpSchema, icpUpdateSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";
export const GET = api(async () =>
  NextResponse.json(
    await sql`SELECT * FROM icp_profiles ORDER BY id LIMIT 100`,
  ),
);
export const POST = api(async (req) => {
  const b = await body(req, icpSchema);
  const [row] = await sql`INSERT INTO icp_profiles ${sql(b)} RETURNING id`;
  return NextResponse.json(row, { status: 201 });
});
export const PUT = api(async (req) => {
  const { id, ...b } = await body(req, icpUpdateSchema);
  const rows =
    await sql`UPDATE icp_profiles SET ${sql(b)} WHERE id=${id} RETURNING id`;
  if (!rows.length) throw new HttpError(404, "Audience not found");
  return NextResponse.json({ ok: true });
});
