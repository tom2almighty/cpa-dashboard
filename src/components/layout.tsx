import { useQuery } from "@tanstack/react-query";
import {
  ChartColumn,
  FileCog,
  KeySquare,
  LayoutDashboard,
  LogOut,
  Network,
  Puzzle,
  ScrollText,
  Tags,
  Users,
} from "lucide-react";
import { Suspense } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLogout } from "@/hooks/use-logout";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { PresetProvider } from "@/lib/preset";
import type { Status } from "@/lib/types";

const USAGE_NAV = [
  { to: "/", label: "概览", icon: LayoutDashboard },
  { to: "/usage", label: "用量", icon: ChartColumn },
  { to: "/prices", label: "模型价格", icon: Tags },
];

const CPA_NAV = [
  { to: "/accounts", label: "账号", icon: Users },
  { to: "/oauth", label: "OAuth 登录", icon: KeySquare },
  { to: "/providers", label: "提供商", icon: Network },
  { to: "/plugins", label: "插件", icon: Puzzle },
  { to: "/logs", label: "日志", icon: ScrollText },
  { to: "/config", label: "配置", icon: FileCog },
];

function NavGroup({ label, items }: { label: string; items: typeof USAGE_NAV }) {
  const { pathname } = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)}
                tooltip={item.label}
                render={<NavLink to={item.to} end={item.to === "/"} />}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function CollectorStatus() {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: () => api<Status>("/api/status"),
    refetchInterval: 15_000,
  });
  if (!data) return null;
  const ok = !data.collector.lastError;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0" />
        }
      >
        <span
          aria-hidden
          className={ok ? "size-2 shrink-0 rounded-full bg-success" : "size-2 shrink-0 rounded-full bg-destructive"}
        />
        <span className="truncate group-data-[collapsible=icon]:hidden">
          {ok ? `用量采集正常，${formatRelative(data.collector.lastSuccessAt)}` : "用量采集异常"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-72">
        {ok ? (
          <>
            已记录 {data.events.toLocaleString()} 条请求
            <br />
            CPA:{data.cpaUrl}
          </>
        ) : (
          data.collector.lastError
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function Layout() {
  const logout = useLogout();
  return (
    <PresetProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex h-8 items-center gap-2 px-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <img src="/favicon.svg" alt="" className="size-5" />
              <span className="group-data-[collapsible=icon]:hidden">CPA Dashboard</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <NavGroup label="用量统计" items={USAGE_NAV} />
            <NavGroup label="CPA 管理" items={CPA_NAV} />
          </SidebarContent>
          <SidebarFooter>
            <CollectorStatus />
            <SidebarMenu>
              <SidebarMenuItem>
                <ThemeToggle />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="退出登录" onClick={() => logout.mutate()}>
                  <LogOut />
                  <span>退出登录</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
            <SidebarTrigger />
            <span className="font-semibold">CPA Dashboard</span>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">
            <Suspense fallback={<Spinner className="mx-auto mt-24 size-6 text-muted-foreground" />}>
              <Outlet />
            </Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </PresetProvider>
  );
}
