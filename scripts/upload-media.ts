try {
  process.loadEnvFile(".env.local");
} catch {
  /* exported environment */
}
import { uploadMedia } from "../lib/media";
import { sql } from "../lib/db";
async function main() {
  const path = process.argv[2];
  if (!path)
    throw new Error("Usage: npm run upload-media -- FILE [CREATIVE_ID]");
  const raw = process.argv[3];
  const id = raw ? Number(raw) : null;
  if (id !== null && (!Number.isSafeInteger(id) || id <= 0))
    throw new Error("Invalid creative ID");
  if (id) {
    const [c] = await sql`SELECT status FROM creatives WHERE id=${id}`;
    if (!c || c.status === "launched")
      throw new Error("Choose an existing unlaunched creative");
  }
  const url = await uploadMedia(path);
  if (id) {
    const rows =
      await sql`UPDATE creatives SET asset_url=${url} WHERE id=${id} AND status<>'launched' RETURNING id`;
    if (!rows.length)
      throw new Error(
        "Creative changed during upload; asset uploaded, recheck record before attaching",
      );
  }
  console.log(url);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
