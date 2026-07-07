"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Error boundary for the dashboard route segment — catches errors thrown while
 * rendering dashboard pages (e.g. a failed database query) and shows a friendly
 * retry screen inside the app shell instead of a raw stack trace.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // In development the raw message is available; surface a DB-specific hint.
  const looksLikeDbError =
    /ECONNREFUSED|database|connection|Failed query|terminating connection/i.test(
      error.message,
    );

  return (
    <div className="mx-auto grid max-w-xl place-items-center py-12">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            <AlertTriangle className="size-5" />
          </div>
          <CardTitle>
            {looksLikeDbError ? "Can’t reach the database" : "Something went wrong"}
          </CardTitle>
          <CardDescription>
            {looksLikeDbError
              ? "Eventify couldn’t connect to its database. Make sure the database is running, then try again."
              : "An unexpected error occurred while loading this page. You can retry, or head back to the dashboard."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button onClick={() => unstable_retry()}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
          <Link href="/">
            <Button variant="outline">Back to dashboard</Button>
          </Link>
          {error.digest ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Ref: {error.digest}
            </span>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
