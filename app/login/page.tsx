"use client";

import { mutate } from "@/lib/client";
import { useState } from "react";
import { Megaphone } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const res = await mutate("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setPending(false);
    if (res) window.location.assign(new URL("/", window.location.origin).href);
    else setError(true);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-surface">
      <form onSubmit={submit} className="card p-8 w-80 text-center">
        <Megaphone className="w-8 h-8 text-accent mx-auto mb-3" />
        <h1 className="text-white font-semibold mb-1">Facebook Ads Studio</h1>
        <p className="text-[12px] text-slate-500 mb-5">
          Enter the access password
        </p>
        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          autoComplete="username"
          className="input mb-3"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          autoComplete="current-password"
          type="password"
          autoFocus
          className="input mb-3 text-center"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
        />
        {error && (
          <p className="text-[12px] text-red-400 mb-3">
            Sign-in failed. Check your credentials or try again later.
          </p>
        )}
        <button
          className="btn-primary w-full"
          type="submit"
          disabled={!password || pending}
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
