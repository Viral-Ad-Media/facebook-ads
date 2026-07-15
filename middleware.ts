import { NextRequest, NextResponse } from "next/server";

// Simple shared-password gate: /api/login sets a cookie holding the SHA-256 of
// ADMIN_PASSWORD; everything else requires it. Keeps the hosted ads console
// (which can queue spend-affecting jobs) off the open internet.

async function expectedToken(): Promise<string | null> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null; // no password configured → gate disabled (local dev)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const token = await expectedToken();
  if (!token) {
    // Fail closed in production: an unconfigured ads console must not be
    // publicly writable. Local dev (no ADMIN_PASSWORD) stays open.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(
        "Locked: set the ADMIN_PASSWORD environment variable in Vercel and redeploy.",
        { status: 503 }
      );
    }
    return NextResponse.next();
  }
  if (req.cookies.get("ads_key")?.value === token) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico|assets).*)"],
};
