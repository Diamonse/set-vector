// Copies the ONNX Runtime Web WASM runtime into public/ort so the app serves it from its
// own origin instead of a CDN. Runs after npm install.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "onnxruntime-web", "dist");
const target = join(root, "public", "ort");
const files = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];

if (!existsSync(source)) {
  console.warn("onnxruntime-web is not installed; skipping WASM copy");
  process.exit(0);
}
mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(source, file), join(target, file));
console.log(`copied ${files.length} ONNX Runtime files to public/ort`);
