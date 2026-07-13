import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const db = getDb();
  const rows = status
    ? db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY id DESC LIMIT 50").all(status)
    : db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 50").all();
  const pending = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status='pending'").get() as {
    c: number;
  };
  return NextResponse.json({ jobs: rows, pending: pending.c });
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const info = getDb()
    .prepare("INSERT INTO jobs (type, payload) VALUES (?, ?)")
    .run(b.type, JSON.stringify(b.payload ?? {}));
  return NextResponse.json({ id: info.lastInsertRowid });
}
