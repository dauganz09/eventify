"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Renders children only after hydration — avoids SSR/client markup drift. */
export function AfterHydration({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return children;
}
