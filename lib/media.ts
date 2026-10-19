import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
export async function uploadMedia(
  path: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const base = new URL(env.STORAGE_URL ?? "");
  if (base.protocol !== "https:" || base.username || base.password)
    throw new Error("STORAGE_URL must be HTTPS");
  const bucket = env.STORAGE_BUCKET;
  if (!bucket || !/^[-a-zA-Z0-9_]+$/.test(bucket) || !env.STORAGE_SERVICE_KEY)
    throw new Error("Set STORAGE_BUCKET and STORAGE_SERVICE_KEY");
  const ext = extname(path).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
  };
  if (!types[ext])
    throw new Error("Only PNG, JPEG, WebP or MP4 assets are supported");
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > 250 * 1024 * 1024)
    throw new Error("Asset must be a nonempty file of at most 250 MB");
  const data = await readFile(path);
  const key = `creatives/${randomUUID()}${ext}`;
  const response = await fetcher(
    new URL(`/storage/v1/object/${bucket}/${key}`, base),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STORAGE_SERVICE_KEY}`,
        apikey: env.STORAGE_SERVICE_KEY,
        "Content-Type": types[ext],
        "x-upsert": "false",
      },
      body: data,
    },
  );
  if (!response.ok) throw new Error(`Media upload failed (${response.status})`);
  const publicUrl = new URL(`/storage/v1/object/public/${bucket}/${key}`, base)
    .href;
  const check = await fetcher(publicUrl, { method: "HEAD" });
  if (!check.ok)
    throw new Error(
      "Uploaded asset is not public. Configure a public creative bucket.",
    );
  return publicUrl;
}
