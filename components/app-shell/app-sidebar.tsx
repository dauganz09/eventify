"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, Gauge, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DEVELOPER } from "@/lib/branding";
import { InstallButton } from "@/components/pwa/install-button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navigationItems = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/events", label: "Events", icon: ClipboardList },
  { href: "/tabulator", label: "Tabulator", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: ShieldCheck },
];

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({
  canViewEvents = true,
}: {
  canViewEvents?: boolean;
}) {
  const pathname = usePathname();
  const items = canViewEvents
    ? navigationItems
    : navigationItems.filter((item) => item.href !== "/events");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/" />}
              tooltip="Eventify"
            >
              <Image
                src="/icons/icon-192.png"
                alt="Eventify"
                width={32}
                height={32}
                className="aspect-square size-8 rounded-lg"
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Eventify</span>
                <span className="truncate text-xs">Event scoring</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    tooltip={item.label}
                    isActive={isActiveRoute(pathname, item.href)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <Badge className="w-full justify-center" variant="secondary">
          Local Mode
        </Badge>
        <InstallButton />
        <p className="px-2 pt-1 text-center text-[11px] leading-tight text-muted-foreground group-data-[collapsible=icon]:hidden">
          Developed by{" "}
          <span className="font-medium text-foreground/80">{DEVELOPER}</span>
        </p>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
