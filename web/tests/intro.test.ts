import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTRO_FADE_MS, INTRO_INIT_SCRIPT, INTRO_MS, INTRO_REDUCED_MS, INTRO_SEEN_KEY } from "@/lib/intro";

/** Run the head script against a minimal browser stand-in. */
function boot({ seen = false, reduced = false, path = "/" } = {}) {
  const attrs = new Map<string, string>();
  const store = new Map<string, string>(seen ? [[INTRO_SEEN_KEY, "1"]] : []);
  const listeners = new Map<string, () => void>();
  const win = {
    location: { pathname: path },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    matchMedia: () => ({ matches: reduced }),
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    __setvectorIntroEnd: undefined as undefined | (() => void),
  };
  const doc = {
    documentElement: {
      getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => attrs.set(n, v),
      removeAttribute: (n: string) => attrs.delete(n),
    },
  };
  new Function("window", "document", INTRO_INIT_SCRIPT)(win, doc);
  return { intro: () => attrs.get("data-intro") ?? null, store, listeners, win };
}

describe("first-load intro script", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows on the first load, ends after 3 seconds, then fades out", () => {
    const b = boot();
    expect(b.intro()).toBe("on");
    expect(b.store.get(INTRO_SEEN_KEY)).toBe("1");
    vi.advanceTimersByTime(INTRO_MS - 1);
    expect(b.intro()).toBe("on");
    vi.advanceTimersByTime(1);
    expect(b.intro()).toBe("leaving");
    vi.advanceTimersByTime(INTRO_FADE_MS);
    expect(b.intro()).toBeNull();
  });

  it("does not show again in the same tab session", () => {
    expect(boot({ seen: true }).intro()).toBeNull();
  });

  it("plays only on the landing page, without spending the tab's first visit elsewhere", () => {
    for (const path of ["/login", "/signup", "/library", "/plans/abc"]) {
      const b = boot({ path });
      expect(b.intro()).toBeNull();
      expect(b.store.has(INTRO_SEEN_KEY)).toBe(false);
    }
  });

  it("ends early on a key press, click, or the Skip button, and stops listening", () => {
    const b = boot();
    vi.advanceTimersByTime(500);
    b.listeners.get("keydown")!();
    expect(b.intro()).toBe("leaving");
    expect(b.listeners.size).toBe(0);
    const c = boot();
    c.win.__setvectorIntroEnd!();
    expect(c.intro()).toBe("leaving");
  });

  it("is short and has no fade with reduced motion", () => {
    const b = boot({ reduced: true });
    vi.advanceTimersByTime(INTRO_REDUCED_MS - 1);
    expect(b.intro()).toBe("on");
    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();
    expect(b.intro()).toBeNull();
  });
});
