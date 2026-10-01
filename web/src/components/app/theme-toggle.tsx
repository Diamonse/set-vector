"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

function subscribe(callback: () => void) {
  window.addEventListener("setvector-theme", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("setvector-theme", callback);
    window.removeEventListener("storage", callback);
  };
}

/** Light, dark, or follow the system. The choice is remembered in this browser. */
export function ThemeToggle({ className }: { className?: string }) {
  // The server cannot know the stored choice, so it renders "system" and the client corrects it.
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => "system" as ThemeChoice);
  return (
    <div role="group" aria-label="Color theme" className={cn("inline-flex items-center gap-0.5 rounded-full border border-divider bg-surface-subtle/70 p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            title={`${label} theme`}
            onClick={() => applyThemeChoice(value)}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:text-ink",
              active && "bg-surface text-ink shadow-card",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="sr-only">{label} theme</span>
          </button>
        );
      })}
    </div>
  );
}
