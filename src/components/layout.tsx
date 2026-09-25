import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpCircle,
  Boxes,
  ChartColumn,
  FileCog,
  KeyRound,
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
import { Logo } from "@/components/logo";
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
import { api, request } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { LITE } from "@/lib/mode";
import { PresetProvider } from "@/lib/preset";
import type { Status } from "@/lib/types";

type NavItem = { to: string; label: string; icon: typeof Users };

const USAGE_NAV: NavItem[] = LITE
  ? [{ to: "/", label: "状态", icon: Activity }]
  : [
      { to: "/", label: "概览", icon: LayoutDashboard },
      { to: "/usage", label: "用量", icon: ChartColumn },
      { to: "/prices", label: "模型价格", icon: Tags },
    ];

const CPA_NAV: NavItem[] = [
  { to: "/accounts", label: "账号", icon: Users },
  { to: "/oauth", label: "OAuth 登录", icon: KeySquare },
  { to: "/providers", label: "提供商", icon: Network },
  { to: "/models", label: "模型", icon: Boxes },
  { to: "/api-keys", label: "API Key", icon: KeyRound },
  { to: "/plugins", label: "插件", icon: Puzzle },
  { to: "/logs", label: "日志", icon: ScrollText },
  { to: "/config", label: "配置", icon: FileCog },
];

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
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

const footerRow =
  "flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0";

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
      <TooltipTrigger render={<div className={footerRow} />}>
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${ok ? "bg-success" : "bg-destructive"}`} />
        <span className="truncate group-data-[collapsible=icon]:hidden">
          {ok ? `用量采集正常，${formatRelative(data.collector.lastSuccessAt)}` : "用量采集异常"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-72">
        {ok ? `已记录 ${data.events.toLocaleString()} 条请求，CPA 地址 ${data.cpaUrl}` : data.collector.lastError}
      </TooltipContent>
    </Tooltip>
  );
}

function newer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).map(Number);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// 管理接口的每个响应都带 X-CPA-VERSION;latest-version 由 CPA 去 GitHub 查询
function CpaVersion() {
  const { data } = useQuery({
    queryKey: ["cpa", "version"],
    queryFn: async () => {
      const res = await request("/v0/management/latest-version");
      const body = res.ok ? ((await res.json().catch(() => ({}))) as { "latest-version"?: string }) : {};
      return { current: res.headers.get("x-cpa-version"), latest: body["latest-version"] ?? null };
    },
    staleTime: 3_600_000,
    refetchOnWindowFocus: false,
  });
  if (!data?.current) return null;
  const update = data.latest && newer(data.latest, data.current) ? data.latest : null;
  return (
    <div className={footerRow}>
      {update ? (
        <a
          href="https://github.com/router-for-me/CLIProxyAPI/releases/latest"
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-2 text-foreground hover:underline"
          title={`CPA ${data.current}，可更新到 ${update}`}
        >
          <ArrowUpCircle className="size-3.5 shrink-0 text-chart-1" aria-hidden />
          <span className="truncate group-data-[collapsible=icon]:hidden">可更新到 {update}</span>
        </a>
      ) : (
        <span className="truncate group-data-[collapsible=icon]:hidden">CPA {data.current}</span>
      )}
    </div>
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
              <Logo className="size-5 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">CPA Dashboard</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <NavGroup label={LITE ? "运行" : "用量统计"} items={USAGE_NAV} />
            <NavGroup label="CPA 管理" items={CPA_NAV} />
          </SidebarContent>
          <SidebarFooter>
            {!LITE && <CollectorStatus />}
            <CpaVersion />
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
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:hidden">
            <SidebarTrigger />
            <Logo className="size-5" />
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
