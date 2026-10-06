"use client";
import { useEffect, useState } from "react";
export default function RequestStatus() {
  const [states, setStates] = useState<
    Record<string, { error: string | null; loading: boolean }>
  >({});
  useEffect(() => {
    const listener = (event: Event) => {
      const { url, error, loading } = (event as CustomEvent).detail;
      setStates((s) => ({ ...s, [url]: { error, loading } }));
    };
    window.addEventListener("fbads:request", listener);
    return () => window.removeEventListener("fbads:request", listener);
  }, []);
  const errors = Object.values(states).filter((s) => s.error);
  const loading = Object.values(states).some((s) => s.loading);
  if (errors.length)
    return (
      <div
        role="alert"
        className="card border-red-500 p-3 mb-4 text-sm text-red-200"
      >
        {Array.from(new Set(errors.map((s) => s.error))).join(" · ")}{" "}
        <button
          className="underline ml-2"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>{" "}
        <a className="underline ml-2" href="/login">
          Sign in
        </a>
      </div>
    );
  return loading ? (
    <div role="status" className="text-xs text-slate-400 mb-2">
      Loading…
    </div>
  ) : null;
}
