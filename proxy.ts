import { NextRequest, NextResponse } from "next/server";
import { COOKIE, users, session, engineAuthorized } from "./lib/auth";
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  try {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.get("origin");
      if (
        (origin && origin !== req.nextUrl.origin) ||
        req.headers.get("sec-fetch-site") === "cross-site"
      )
        return NextResponse.json(
          { error: "Cross-origin write rejected" },
          { status: 403 },
        );
    }
    if (path === "/api/engine")
      return engineAuthorized(req.headers.get("authorization"))
        ? NextResponse.next()
        : NextResponse.json(
            { error: "Engine authorization required" },
            { status: 401 },
          );
    const configured = Object.keys(users()).length > 0;
    if (!configured) {
      if (process.env.NODE_ENV === "production")
        return new NextResponse(
          "Locked: configure ADMIN_PASSWORD or ADMIN_USERS_JSON and restart.",
          { status: 503 },
        );
      return NextResponse.next();
    }
    if (path === "/login" || path === "/api/login") return NextResponse.next();
    const current = await session(req.cookies.get(COOKIE)?.value);
    if (current) {
      if (
        current.role === "viewer" &&
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        path != "/api/logout"
      )
        return NextResponse.json(
          { error: "Read-only account" },
          { status: 403 },
        );
      return NextResponse.next();
    }
    if (path.startsWith("/api/"))
      return NextResponse.json(
        { error: "Sign in to continue" },
        { status: 401 },
      );
    return NextResponse.redirect(new URL("/login", req.url));
  } catch {
    return NextResponse.json(
      {
        error:
          "Access unavailable. Check authentication and database configuration.",
      },
      { status: 503 },
    );
  }
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
