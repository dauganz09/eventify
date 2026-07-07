// Local-mode auth client. Same API shape as the Supabase browser client so
// the login page requires no changes. Swap this file when re-integrating Supabase.
export function createClient() {
  return {
    auth: {
      async signUp({ email, password }: { email: string; password: string }) {
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) return { data: null, error: new Error(data.error) };
        return { data, error: null };
      },

      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) return { data: null, error: new Error(data.error) };
        return { data, error: null };
      },

      async signOut() {
        await fetch("/api/auth/logout", { method: "POST" });
        return { error: null };
      },
    },
  };
}
