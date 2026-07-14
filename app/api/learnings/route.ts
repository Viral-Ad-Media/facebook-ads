import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sql`SELECT * FROM learnings ORDER BY confidence DESC, updated_at DESC LIMIT 50`;
  return NextResponse.json(rows);
}
