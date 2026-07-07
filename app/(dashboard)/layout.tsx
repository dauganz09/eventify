import { AppShell } from "@/components/app-shell/app-shell";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireAuthContext();
  return (
    <AppShell
      user={{
        name: context.profile.displayName ?? context.email.split("@")[0],
        email: context.email,
        role: context.roles[0],
      }}
      canViewEvents={hasPermission(context.authorization, "event.view")}
    >
      {children}
    </AppShell>
  );
}
