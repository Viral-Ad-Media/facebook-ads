import { NextResponse } from "next/server";
import { z } from "zod";
import { api, body } from "@/lib/http";
import { COOKIE, login } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const POST = api(async (req) => {
  const { username, password } = await body(
    req,
    z
      .object({
        username: z.string().min(1).max(50).default("admin"),
        password: z.string().min(1).max(1024),
      })
      .strict(),
  );
  const result = await login(username, password);
  if ("error" in result)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 3600,
  });
  return response;
});
