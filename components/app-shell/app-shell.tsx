import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { UserMenu } from "@/components/app-shell/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export function AppShell({
  children,
  user,
  canViewEvents = true,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role?: string };
  canViewEvents?: boolean;
}) {
  return (
    <SidebarProvider>
      <div className="print:hidden contents">
        <AppSidebar canViewEvents={canViewEvents} />
      </div>
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            orientation="vertical"
          />
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle size="icon-sm" />
            <UserMenu name={user.name} email={user.email} role={user.role} />
          </div>
        </header>
        <div className="flex flex-1 flex-col">
          <div className="w-full flex-1 p-4 sm:p-6 lg:p-8 print:p-0">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
