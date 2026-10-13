import { describe, expect, it } from "vitest";
import { cacheUntilFailure } from "@/lib/analysis/model-cache";

describe("model load caching", () => {
  it("loads once and reuses a successful result", async () => {
    let calls = 0;
    const get = cacheUntilFailure(async () => ({ model: ++calls }));
    expect(await get()).toEqual({ model: 1 });
    expect(await get()).toEqual({ model: 1 });
    expect(calls).toBe(1);
  });

  it("reuses a null result, since no published model is a real state", async () => {
    let calls = 0;
    const get = cacheUntilFailure(async () => {
      calls++;
      return null;
    });
    expect(await get()).toBeNull();
    expect(await get()).toBeNull();
    expect(calls).toBe(1);
  });

  it("reports a failure and retries on the next call", async () => {
    let calls = 0;
    const get = cacheUntilFailure(async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return { model: calls };
    });
    expect(await get()).toEqual({ error: "network down" });
    expect(await get()).toEqual({ model: 2 });
    expect(await get()).toEqual({ model: 2 });
    expect(calls).toBe(2);
  });

  it("shares one pending load between concurrent callers", async () => {
    let calls = 0;
    const get = cacheUntilFailure(async () => ({ model: ++calls }));
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toEqual({ model: 1 });
    expect(b).toEqual({ model: 1 });
    expect(calls).toBe(1);
  });
});
