"use client";

import { useEffect } from "react";

/** Strip dark mode on print routes so theme tokens never override report styles. */
export function PrintLightMode({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains("dark");
    html.classList.remove("dark");
    html.style.colorScheme = "light";
    return () => {
      if (hadDark) html.classList.add("dark");
      html.style.colorScheme = "";
    };
  }, []);

  return children;
}
