"use client";

import { useEffect } from "react";
import { loadCdjScene } from "./cdj-loader";

/** Downloads the 3D loader while the browser is idle, so the first route change shows it at once. */
export function PrefetchCdj() {
  useEffect(() => {
    const warm = () => void loadCdjScene().catch(() => {});
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 2000);
    return () => clearTimeout(id);
  }, []);
  return null;
}
