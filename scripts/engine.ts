try {
  process.loadEnvFile(".env.local");
} catch {
  /* exported environment */
}
const endpoint = process.env.ENGINE_BASE_URL ?? "http://localhost:3100";
const url = new URL("/api/engine", endpoint);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
)
  throw new Error("ENGINE_BASE_URL must use HTTPS outside localhost");
if (!process.env.ENGINE_TOKEN) throw new Error("ENGINE_TOKEN is required");
async function main() {
  const payload = JSON.parse(process.argv[2] ?? "{}");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ENGINE_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error ?? `Engine request failed (${response.status})`,
    );
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
