"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once on the client. Kept out of the render tree
 * (returns null) so it can sit at the root layout without affecting markup.
 * Only registers in production builds — a dev SW caches stale chunks and breaks
 * Fast Refresh.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failures are non-fatal; the app works without the SW.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
