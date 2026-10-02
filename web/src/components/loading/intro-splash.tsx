"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/app/logo";
import { INTRO_FADE_MS } from "@/lib/intro";
import { CdjLoader } from "./cdj-loader";

declare global {
  interface Window {
    __setvectorIntroEnd?: () => void;
  }
}

/**
 * Full-screen CDJ intro on the first load of a browser tab session. The head script
 * (INTRO_INIT_SCRIPT) decides whether it shows and when it ends, before the app hydrates;
 * CSS keys the overlay and its fade off html[data-intro]. This component only adds the 3D
 * deck while the intro is up and offers a Skip button. The page loads underneath.
 */
export function IntroSplash() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setActive(root.hasAttribute("data-intro"));
    sync();
    if (!root.hasAttribute("data-intro")) return;
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div id="intro-splash" className="fixed inset-0 z-[100] flex-col items-center justify-center gap-6 bg-canvas px-4" style={{ transitionDuration: `${INTRO_FADE_MS}ms` }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_30rem_at_50%_40%,var(--glow-a),transparent_70%)]" />
      {active ? (
        <CdjLoader className="relative" />
      ) : (
        // Shown from first paint until the app hydrates and starts the deck.
        <span aria-hidden className="relative text-muted">
          <LogoMark animated className="h-10 [&>span]:w-[7px]" />
        </span>
      )}
      <button
        type="button"
        onClick={() => window.__setvectorIntroEnd?.()}
        className="relative rounded-full px-4 py-2 text-caption text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
      >
        Skip intro
      </button>
    </div>
  );
}
