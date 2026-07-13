import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM learnings ORDER BY confidence DESC, updated_at DESC LIMIT 50")
    .all();
  return NextResponse.json(rows);
}
