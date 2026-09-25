import { expect, it } from "vitest";
import { cn } from "@/lib/utils";
it("keeps type roles next to colours", () => {
  expect(cn("text-card-title text-ink")).toBe("text-card-title text-ink");
  expect(cn("text-ui text-ink", "text-muted")).toBe("text-ui text-muted");
  expect(cn("text-caption", "text-ui")).toBe("text-ui");
});
