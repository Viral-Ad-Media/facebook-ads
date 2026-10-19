// Failed requests remain visible globally until retry succeeds or the user dismisses them.
export function requestEvent(
  url: string,
  error: string | null,
  loading: boolean,
) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("fbads:request", { detail: { url, error, loading } }),
    );
}
const cache = new Map<string, unknown>();
const retries = new Map<string, number>();
export async function getJson<T>(url: string, fallback: T): Promise<T> {
  if (
    (typeof document !== "undefined" && document.hidden) ||
    Date.now() < (retries.get(url) ?? 0)
  )
    return (cache.get(url) as T) ?? fallback;
  requestEvent(url, null, true);
  try {
    const r = await fetch(url);
    if (!r.ok) {
      let message = `Request failed (${r.status})`;
      try {
        message = (await r.json()).error ?? message;
      } catch {
        /* non JSON */
      }
      throw new Error(message);
    }
    const result = (await r.json()) as T;
    cache.set(url, result);
    retries.delete(url);
    requestEvent(url, null, false);
    return result;
  } catch (e) {
    retries.set(url, Date.now() + 30000);
    requestEvent(url, (e as Error).message, false);
    return (cache.get(url) as T) ?? fallback;
  }
}
const keys = new Map<string, string>();
const pending = new Map<string, Promise<unknown>>();
export async function mutate<T = Record<string, unknown>>(
  url: string,
  options: RequestInit,
): Promise<T | null> {
  const signature = url + options.method + options.body;
  if (pending.has(signature))
    return pending.get(signature) as Promise<T | null>;
  const run = async () => {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (
      options.method === "POST" &&
      !["/api/login", "/api/logout"].includes(url)
    ) {
      if (!keys.has(signature)) keys.set(signature, crypto.randomUUID());
      headers.set("Idempotency-Key", keys.get(signature)!);
    }
    requestEvent(url, null, true);
    try {
      const response = await fetch(url, { ...options, headers });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`Request failed (${response.status})`);
      }
      if (!response.ok)
        throw new Error(result.error ?? `Request failed (${response.status})`);
      keys.delete(signature);
      requestEvent(url, null, false);
      return result as T;
    } catch (e) {
      requestEvent(url, (e as Error).message, false);
      return null;
    }
  };
  const promise = run();
  pending.set(signature, promise);
  try {
    return await promise;
  } finally {
    pending.delete(signature);
  }
}
