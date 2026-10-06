import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadMedia } from "../lib/media";
import { mutate } from "../lib/client";
test("durable media uploader verifies public access and returns an HTTPS asset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ads-media-"));
  try {
    const path = join(directory, "creative.png");
    await writeFile(path, Buffer.from([137, 80, 78, 71]));
    const calls: { url: string; method: string }[] = [];
    const fetcher: typeof fetch = async (url, options) => {
      calls.push({ url: String(url), method: options?.method ?? "GET" });
      return new Response(null, {
        status: options?.method === "HEAD" ? 200 : 201,
      });
    };
    const url = await uploadMedia(
      path,
      {
        STORAGE_URL: "https://project.supabase.co",
        STORAGE_BUCKET: "creatives",
        STORAGE_SERVICE_KEY: "test-key",
      },
      fetcher,
    );
    assert.match(
      url,
      /^https:\/\/project.supabase.co\/storage\/v1\/object\/public\/creatives\/creatives\/.*\.png$/,
    );
    assert.deepEqual(
      calls.map((c) => c.method),
      ["POST", "HEAD"],
    );
    await assert.rejects(() =>
      uploadMedia(
        path,
        {
          STORAGE_URL: "https://project.supabase.co",
          STORAGE_BUCKET: "creatives",
          STORAGE_SERVICE_KEY: "test-key",
        },
        async () => new Response(null, { status: 403 }),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("mutation failures return no success and retries retain their idempotency key", async () => {
  const original = globalThis.fetch;
  const keys: string[] = [];
  let attempt = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      keys.push(new Headers(options?.headers).get("Idempotency-Key")!);
      attempt++;
      return Response.json(
        attempt === 1 ? { error: "Unavailable" } : { id: 1 },
        { status: attempt === 1 ? 503 : 201 },
      );
    };
    const options = {
      method: "POST",
      body: JSON.stringify({ product: "Test" }),
    };
    assert.equal(await mutate("/api/briefs", options), null);
    assert.deepEqual(await mutate("/api/briefs", options), { id: 1 });
    assert.equal(keys[0], keys[1]);
    await mutate("/api/briefs", options);
    assert.notEqual(keys[1], keys[2]);
  } finally {
    globalThis.fetch = original;
  }
});
