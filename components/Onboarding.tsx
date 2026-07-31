"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Megaphone, Bot, Binoculars, Rocket, X, ArrowRight, ArrowLeft } from "lucide-react";

const STORAGE_KEY = "fbads_onboarded_v1";

// ── Intro wizard slides ──────────────────────────────────────────────────────
const SLIDES = [
  {
    icon: Megaphone,
    title: "Welcome to Facebook Ads Studio",
    body: "Your cockpit for the full ad lifecycle: research competitors, generate creatives, preview them exactly as they'll look on Facebook, launch campaigns, and let an optimization engine manage them within guardrails you control.",
  },
  {
    icon: Bot,
    title: "Claude Code is the engine",
    body: "This app never talks to Facebook or the AI generators directly. Buttons queue jobs, and Claude Code executes them: /process-jobs generates creatives, /launch publishes campaigns (always paused first), /monitor syncs results and optimizes. A blue banner tells you when jobs are waiting.",
  },
  {
    icon: Binoculars,
    title: "Start with intelligence",
    body: "Scan competitors' live ads in the Meta Ads Library — ads running 60+ days are proven winners. One click turns any of them into a brief, and every campaign feeds a learnings database that makes your next ad smarter.",
  },
  {
    icon: Rocket,
    title: "Safety is built in",
    body: "Campaigns are always created PAUSED — nothing spends until you activate it. The engine obeys your guardrails (max daily spend, target CPA), every action is logged, and creatives pass a Meta ad-policy compliance check before launch.",
  },
];

// ── Spotlight tour steps (anchored to data-tour attributes) ──────────────────
const TOUR: { target: string; title: string; body: string }[] = [
  { target: "campaigns", title: "Campaigns", body: "Live performance, spend charts, per-ad on/off switches, and the engine's action log — your daily view once ads are running." },
  { target: "competitors", title: "Competitors", body: "Pull competitors' running ads from the Meta Ads Library. Long-running ads are proven winners — steal the angle, not the copy." },
  { target: "studio", title: "Ad Studio", body: "Write a brief, let the engine generate copy + visuals, and preview every variant as a pixel-faithful Facebook ad before spending a cent." },
  { target: "launch", title: "Launch", body: "Pick approved creatives, set audience and budget (with a recommended spend), and hand off to the engine. Everything starts paused." },
  { target: "learnings", title: "Learnings", body: "What's working — hooks, formats, audiences — extracted from your own results and competitor scans. New briefs start pre-loaded with these." },
  { target: "settings", title: "Settings", body: "Set up first: your Facebook Page ID, ideal customer profiles, and the engine's guardrails. The defaults are sane but generic." },
];

export default function Onboarding() {
  const pathname = usePathname();
  const [mode, setMode] = useState<"hidden" | "wizard" | "tour">("hidden");
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setMode("wizard");
    const restart = () => {
      setStep(0);
      setMode("wizard");
    };
    window.addEventListener("fbads:restart-onboarding", restart);
    return () => window.removeEventListener("fbads:restart-onboarding", restart);
  }, []);

  const finish = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "1");
    setMode("hidden");
    setStep(0);
  }, []);

  // Track the highlighted element during the tour
  useEffect(() => {
    if (mode !== "tour") return;
    const el = document.querySelector(`[data-tour="${TOUR[step].target}"]`);
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mode, step]);

  if (mode === "hidden" || pathname === "/login") return null;

  if (mode === "wizard") {
    const slide = SLIDES[step];
    const Icon = slide.icon;
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="card p-8 max-w-md w-full relative">
          <button className="absolute top-3 right-3 text-slate-500 hover:text-slate-300" onClick={finish} title="Skip intro">
            <X className="w-4 h-4" />
          </button>
          <Icon className="w-10 h-10 text-accent mb-4" />
          <h2 className="text-white font-semibold text-lg mb-2">{slide.title}</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">{slide.body}</p>
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {SLIDES.map((_, i) => (
                <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === step ? "bg-accent" : "bg-line"}`} />
              ))}
            </div>
            <div className="flex gap-2">
              {step > 0 && (
                <button className="btn-secondary !py-1.5 flex items-center gap-1" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
              )}
              {step < SLIDES.length - 1 ? (
                <button className="btn-primary !py-1.5 flex items-center gap-1" onClick={() => setStep(step + 1)}>
                  Next <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  className="btn-primary !py-1.5"
                  onClick={() => {
                    setStep(0);
                    setMode("tour");
                  }}
                >
                  Take the tour
                </button>
              )}
            </div>
          </div>
          {step === SLIDES.length - 1 && (
            <button className="mt-3 text-[12px] text-slate-500 hover:text-slate-300" onClick={finish}>
              Skip the tour — let me explore
            </button>
          )}
        </div>
      </div>
    );
  }

  // Tour mode: spotlight the nav item and show an anchored card
  const t = TOUR[step];
  const top = rect ? Math.min(Math.max(rect.top - 8, 12), window.innerHeight - 220) : 100;
  const left = rect ? rect.right + 16 : 240;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={finish} />
      {rect && (
        <div
          className="absolute rounded-lg ring-2 ring-accent bg-white/5 pointer-events-none transition-all duration-200"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className="absolute card p-4 w-72 transition-all duration-200" style={{ top, left }}>
        <div className="text-[11px] text-slate-500 mb-1">
          {step + 1} of {TOUR.length}
        </div>
        <h3 className="text-white font-semibold text-sm mb-1.5">{t.title}</h3>
        <p className="text-[13px] text-slate-400 leading-relaxed mb-4">{t.body}</p>
        <div className="flex items-center justify-between">
          <button className="text-[12px] text-slate-500 hover:text-slate-300" onClick={finish}>
            End tour
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button className="btn-secondary !py-1 !px-2.5 text-[12px]" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {step < TOUR.length - 1 ? (
              <button className="btn-primary !py-1 !px-2.5 text-[12px]" onClick={() => setStep(step + 1)}>
                Next
              </button>
            ) : (
              <button className="btn-primary !py-1 !px-2.5 text-[12px]" onClick={finish}>
                Done — go set up
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
