import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function body<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "JSON required");
  const raw = await req.text();
  if (raw.length > 32768) throw new HttpError(413, "Request too large");
  try {
    return schema.parse(JSON.parse(raw));
  } catch (e) {
    if (e instanceof z.ZodError)
      throw new HttpError(
        400,
        e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    throw new HttpError(400, "Invalid JSON");
  }
}
export function api(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest) => {
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError)
        return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof z.ZodError)
        return NextResponse.json(
          { error: e.issues[0].message },
          { status: 400 },
        );
      console.error(
        "API request failed",
        e instanceof Error ? e.message : "Unknown error",
      );
      return NextResponse.json(
        { error: "Request failed. Check server configuration and retry." },
        { status: 503 },
      );
    }
  };
}
