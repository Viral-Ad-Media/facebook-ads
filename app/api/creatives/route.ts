import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const briefId = req.nextUrl.searchParams.get("brief_id");
  const status = req.nextUrl.searchParams.get("status");
  const db = getDb();
  let sql = `SELECT c.*, b.product, b.landing_url FROM creatives c LEFT JOIN briefs b ON b.id = c.brief_id`;
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (briefId) {
    where.push("c.brief_id = @briefId");
    params.briefId = briefId;
  }
  if (status) {
    where.push("c.status = @status");
    params.status = status;
  }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY c.id DESC";
  return NextResponse.json(db.prepare(sql).all(params));
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  const db = getDb();
  const allowed = ["primary_text", "headline", "description", "cta", "status", "hook"];
  const sets = allowed.filter((k) => k in b).map((k) => `${k}=@${k}`);
  if (!sets.length || !b.id) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  db.prepare(`UPDATE creatives SET ${sets.join(", ")} WHERE id=@id`).run(b);
  return NextResponse.json({ ok: true });
}
