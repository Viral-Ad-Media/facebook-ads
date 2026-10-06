import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* environment may be exported */
}
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url)
    throw new Error(
      "Set MIGRATION_DATABASE_URL to a database administrator connection",
    );
  const db = postgres(url, {
    prepare: false,
    ssl:
      process.env.DATABASE_SSL === "disable" &&
      process.env.NODE_ENV !== "production"
        ? false
        : "verify-full",
    max: 1,
  });
  try {
    await db`CREATE SCHEMA IF NOT EXISTS fbads`;
    await db`CREATE TABLE IF NOT EXISTS fbads.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const name of (await readdir("migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const content = await readFile(`migrations/${name}`, "utf8");
      const checksum = createHash("sha256").update(content).digest("hex");
      await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(310099)`;
        const [existing] =
          await tx`SELECT checksum FROM fbads.schema_migrations WHERE name=${name}`;
        if (existing) {
          if (existing.checksum !== checksum)
            throw new Error(`Migration changed: ${name}`);
          return;
        }
        await tx.unsafe(content);
        await tx`INSERT INTO fbads.schema_migrations(name,checksum) VALUES(${name},${checksum})`;
      });
      console.log(`Verified ${name}`);
    }
  } finally {
    await db.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
