"use client";

import { useEffect, useState } from "react";
import { Lightbulb, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

type Learning = {
  id: number;
  dimension: string;
  insight: string;
  evidence?: string;
  confidence: number;
  updated_at: string;
};

const DIM_COLOR: Record<string, string> = {
  hook: "text-purple-300 bg-purple-400/10",
  format: "text-sky-300 bg-sky-400/10",
  audience: "text-emerald-300 bg-emerald-400/10",
  offer: "text-amber-300 bg-amber-400/10",
  media_type: "text-pink-300 bg-pink-400/10",
};

export default function LearningsPage() {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/learnings").then((r) => r.json()).then(setLearnings);
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Learnings</h1>
      <p className="text-sm text-slate-500 mb-6">
        Insights the engine extracts from your performance database on every{" "}
        <code className="text-accent-soft">/monitor</code> run — so each new ad starts smarter than
        the last.
      </p>

      {learnings.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          No learnings yet. Once campaigns collect data, the engine compares hooks, formats, and
          audiences and records what wins here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {learnings.map((l) => (
            <div key={l.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${DIM_COLOR[l.dimension] ?? "text-slate-300 bg-slate-400/10"}`}>
                  {l.dimension}
                </span>
                <span className="text-[11px] text-slate-500">
                  confidence {(l.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="text-sm text-slate-200 flex gap-2">
                <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                {l.insight}
              </div>
              {l.evidence && (
                <div className="text-[12px] text-slate-500 mt-2 font-mono">{l.evidence}</div>
              )}
              <button
                className="mt-3 text-[12px] text-accent-soft hover:text-accent flex items-center gap-1"
                onClick={() => router.push("/studio")}>
                Use in a new brief <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
