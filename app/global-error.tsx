"use client";

// Last-resort error boundary. Catches errors thrown in the root layout and in
// segment layouts (e.g. the dashboard layout's auth/DB call) — including the
// database being unreachable. It replaces the root layout entirely, so it must
// render its own <html>/<body> and cannot rely on globals.css; styles are
// inlined.
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#f6f8fb",
          color: "#0f172a",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 460,
            width: "100%",
            textAlign: "center",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: "40px 32px",
            boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="Eventify"
            width={64}
            height={64}
            style={{ borderRadius: 16, marginBottom: 20 }}
          />
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p
            style={{
              margin: "0 0 20px",
              lineHeight: 1.5,
              color: "#64748b",
              fontSize: 14,
            }}
          >
            Eventify hit an unexpected error. This is often a temporary
            connection problem with the database — please make sure the database
            is running, then try again.
          </p>
          <div
            style={{ display: "flex", gap: 10, justifyContent: "center" }}
          >
            <button
              onClick={() => unstable_retry()}
              style={{
                font: "inherit",
                fontWeight: 600,
                color: "#fff",
                background: "#1388d5",
                border: 0,
                borderRadius: 10,
                padding: "10px 20px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                font: "inherit",
                fontWeight: 600,
                color: "#0f172a",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "10px 20px",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
          {error.digest ? (
            <p style={{ marginTop: 16, fontSize: 12, color: "#94a3b8" }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
