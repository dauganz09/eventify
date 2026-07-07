import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

/**
 * Branded 404 shown for unmatched routes (and for notFound() calls that aren't
 * caught by a closer boundary).
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <Image
        src="/icons/icon-192.png"
        alt="Eventify"
        width={64}
        height={64}
        className="rounded-2xl"
      />
      <div className="grid gap-2">
        <p className="text-5xl font-bold tracking-tight">404</p>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist or may have been moved.
        </p>
      </div>
      <Link href="/">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
