"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) window.location.href = "/";
    else setError(true);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-surface">
      <form onSubmit={submit} className="card p-8 w-80 text-center">
        <Megaphone className="w-8 h-8 text-accent mx-auto mb-3" />
        <h1 className="text-white font-semibold mb-1">Facebook Ads Studio</h1>
        <p className="text-[12px] text-slate-500 mb-5">Enter the access password</p>
        <input
          type="password"
          autoFocus
          className="input mb-3 text-center"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
        />
        {error && <p className="text-[12px] text-red-400 mb-3">Wrong password</p>}
        <button className="btn-primary w-full" type="submit" disabled={!password}>
          Unlock
        </button>
      </form>
    </div>
  );
}
