import type { MetadataRoute } from "next";

// Web App Manifest (served at /manifest.webmanifest). Next links it into <head>
// automatically. Drives "Install app" on desktop Chrome/Edge and Add to Home
// Screen on mobile.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eventify",
    short_name: "Tabulate",
    description:
      "Dynamic event tabulation for configurable judging workflows — score offline-safe, sync, and tabulate results.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#1388d5",
    categories: ["productivity", "business"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Events",
        short_name: "Events",
        url: "/events",
      },
      {
        name: "Tabulator",
        short_name: "Tabulator",
        url: "/tabulator",
      },
    ],
  };
}
