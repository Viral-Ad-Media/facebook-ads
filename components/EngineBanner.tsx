"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";

/**
 * Shows pending engine jobs. The web app never calls Facebook/Higgsfield
 * itself — Claude Code drains the queue via /process-jobs, /launch, /monitor.
 */
export default function EngineBanner() {
  const [pending, setPending] = useState(0);
  const [types, setTypes] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/jobs?status=pending");
        const data = await res.json();
        if (!alive) return;
        setPending(data.pending ?? 0);
        setTypes(Array.from(new Set((data.jobs ?? []).map((j: any) => j.type))));
      } catch {
        /* server restarting */
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!pending) return null;

  const cmd = types.includes("launch_campaign")
    ? "/launch"
    : types.includes("competitor_scan")
      ? "/competitor-scan"
      : "/process-jobs";
  return (
    <div className="card border-accent/40 bg-accent/10 px-4 py-3 flex items-center gap-3 mb-6">
      <Bot className="w-5 h-5 text-accent-soft shrink-0" />
      <div className="text-sm">
        <span className="font-medium text-white">{pending} job{pending > 1 ? "s" : ""} waiting for the engine.</span>{" "}
        <span className="text-slate-400">
          In Claude Code, run <code className="text-accent-soft">{cmd}</code> to execute
          ({types.join(", ")}).
        </span>
      </div>
    </div>
  );
}
