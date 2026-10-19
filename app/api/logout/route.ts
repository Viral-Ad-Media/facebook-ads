import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { COOKIE, hash } from "@/lib/auth";
import { api } from "@/lib/http";
export const POST = api(async (req) => {
  const token = req.cookies.get(COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE token_hash=${hash(token)}`;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return response;
});
