import Image from "next/image";
import { DEVELOPER_CREDIT } from "@/lib/branding";
import { AuthBrandPanel } from "@/components/auth/brand-panel";
import { JudgeLoginForm } from "./judge-login-form";

const ERROR_MESSAGES: Record<string, string> = {
  released:
    "Your session was released by the tabulator. Please sign in again to continue.",
  expired: "Your session expired. Please sign in again.",
  invalid: "Your session is no longer valid. Please sign in again.",
};

export default async function JudgeLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const notice = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Left panel — branded banner ── */}
      <AuthBrandPanel />

      {/* ── Right panel — form ── */}
      <div className="flex w-full flex-col lg:w-[45%]">
        {/* Mobile header */}
        <div className="flex items-center gap-2 p-6 lg:hidden">
          <Image
            src="/icons/icon-192.png"
            alt="Eventify"
            width={28}
            height={28}
            className="size-7 rounded-md"
          />
          <span className="font-semibold">Eventify</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
          <div className="w-full max-w-[360px] space-y-8">

            {/* Badge */}
            <div className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
              Judge workspace
            </div>

            {/* Heading */}
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
              <p className="text-sm text-muted-foreground">
                Enter the credentials provided by your event organizer.
              </p>
            </div>

            {notice && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
                {notice}
              </div>
            )}

            <JudgeLoginForm />

          </div>
        </div>

        <p className="p-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Eventify · {DEVELOPER_CREDIT}
        </p>
      </div>
    </div>
  );
}
