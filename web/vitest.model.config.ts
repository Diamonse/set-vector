import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Model integration tests need an exported ONNX model and a PyTorch reference, which are
// not committed; see web/README.md, "Beat detection model".
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/model/**/*.test.ts"],
    environment: "node",
    testTimeout: 600_000,
  },
});
