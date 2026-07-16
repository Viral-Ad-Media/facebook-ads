// Safe JSON fetch for client components. During redeploys, auth lockouts, or
// transient errors the API can answer with 401/503, HTML, or an empty body —
// parsing those with res.json() throws. This returns the fallback instead.
export async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}
