import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const rows = status
    ? await sql`SELECT * FROM jobs WHERE status = ${status} ORDER BY id DESC LIMIT 50`
    : await sql`SELECT * FROM jobs ORDER BY id DESC LIMIT 50`;
  const [pending] = await sql`SELECT COUNT(*)::int as c FROM jobs WHERE status='pending'`;
  return NextResponse.json({ jobs: rows, pending: pending.c });
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const [row] = await sql`
    INSERT INTO jobs (type, payload) VALUES (${b.type}, ${JSON.stringify(b.payload ?? {})})
    RETURNING id`;
  return NextResponse.json({ id: row.id });
}
