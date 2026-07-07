"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { DEVELOPER_CREDIT } from "@/lib/branding";
import { AuthBrandPanel } from "@/components/auth/brand-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    const client = createClient();
    try {
      if (mode === "sign-up") {
        const { error: e } = await client.auth.signUp({ email, password });
        if (e) throw e;
      } else {
        const { error: e } = await client.auth.signInWithPassword({ email, password });
        if (e) throw e;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setIsLoading(false);
    }
  }

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

            {/* Heading */}
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {mode === "sign-in" ? "Welcome back" : "Get started"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {mode === "sign-in"
                  ? "Sign in to your organizer account."
                  : "Create your organizer account."}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">
                    Password
                  </Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  className="h-11"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="h-11 w-full gap-2 text-sm font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Please wait…
                  </>
                ) : (
                  <>
                    {mode === "sign-in" ? "Sign in" : "Create account"}
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>

            {/* Toggle */}
            <p className="text-center text-sm text-muted-foreground">
              {mode === "sign-in" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"))}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {mode === "sign-in" ? "Sign up" : "Sign in"}
              </button>
            </p>

          </div>
        </div>

        {/* Footer */}
        <p className="p-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Eventify · {DEVELOPER_CREDIT}
        </p>
      </div>
    </div>
  );
}
