"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Opens same-origin pages (present / print / scoresheet) in a new browser
 * tab. When the dashboard itself is running as an installed standalone PWA
 * (no tab strip), `target="_blank"` instead spawns a whole separate app
 * window, so we detect that case on mount and fall back to a same-window
 * navigation.
 */
export function NewTabLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches);
  }, []);

  return (
    <Link
      href={href}
      target={standalone ? undefined : "_blank"}
      rel={standalone ? undefined : "noopener"}
      className={className}
    >
      {children}
    </Link>
  );
}
