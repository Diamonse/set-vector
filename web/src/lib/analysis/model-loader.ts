/** Fetches the Beat This! ONNX model with its manifest, verifies SHA-256, and caches it. */

export interface ModelManifest {
  name: string;
  file: string;
  sha256: string;
  sourceWeights: string;
  upstream: string;
}

export interface LoadedModel {
  manifest: ModelManifest;
  bytes: Uint8Array;
}

const CACHE = "setvector-models-v1";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns null when no model is published (the manifest is missing), so the caller can
 * fall back to the DSP beat tracker. Throws when a model exists but fails verification.
 */
export async function loadBeatModel(manifestUrl: string, pinnedSha256?: string): Promise<LoadedModel | null> {
  const manifestResponse = await fetch(manifestUrl, { cache: "no-cache" });
  if (manifestResponse.status === 404) return null;
  if (!manifestResponse.ok) throw new Error(`model manifest request failed with ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as ModelManifest;
  if (!/^[0-9a-f]{64}$/.test(manifest.sha256)) throw new Error("model manifest has no valid SHA-256");
  if (pinnedSha256 && pinnedSha256 !== manifest.sha256) throw new Error("model manifest does not match the pinned SHA-256");
  const modelUrl = new URL(manifest.file, new URL(manifestUrl, self.location.href)).toString();

  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  let response = cache ? await cache.match(modelUrl) : undefined;
  let fromCache = true;
  if (!response) {
    fromCache = false;
    response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`model request failed with ${response.status}`);
  }
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  const actual = await sha256Hex(bytes);
  if (actual !== manifest.sha256) {
    if (cache && fromCache) await cache.delete(modelUrl);
    throw new Error(`model SHA-256 ${actual.slice(0, 12)}… does not match the manifest`);
  }
  if (cache && !fromCache) await cache.put(modelUrl, response).catch(() => undefined);
  return { manifest, bytes };
}
