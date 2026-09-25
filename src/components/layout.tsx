import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpCircle,
  Boxes,
  FileCog,
  KeyRound,
  KeySquare,
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
import { useLogout } from "@/hooks/use-logout";
import { request } from "@/lib/api";

type NavItem = { to: string; label: string; icon: typeof Users };

const OVERVIEW_NAV: NavItem[] = [{ to: "/", label: "运行概览", icon: Activity }];

const GATEWAY_NAV: NavItem[] = [
  { to: "/accounts", label: "账号", icon: Users },
  { to: "/oauth", label: "OAuth 登录", icon: KeySquare },
  { to: "/providers", label: "提供商", icon: Network },
  { to: "/api-keys", label: "API Key", icon: KeyRound },
];

const MODEL_NAV: NavItem[] = [
  { to: "/models", label: "模型管理", icon: Boxes },
  { to: "/prices", label: "模型价格", icon: Tags },
];

const SYSTEM_NAV: NavItem[] = [
  { to: "/plugins", label: "插件", icon: Puzzle },
  { to: "/logs", label: "日志", icon: ScrollText },
  { to: "/config", label: "系统配置", icon: FileCog },
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

const FRONTEND_VERSION = "v0.1.0";

function newer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).map(Number);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}
// 管理接口响应带 X-CPA-VERSION; latest-version 由 CPA 查询
function VersionInfo() {
  const { data } = useQuery({
    queryKey: ["cpa", "version"],
    queryFn: async () => {
      const res = await request("/v0/management/latest-version");
      const body = res.ok ? ((await res.json().catch(() => ({}))) as { "latest-version"?: string }) : {};
      return {
        current: res.headers.get("x-cpa-version") || "未知",
        latest: body["latest-version"] ?? null,
      };
    },
    staleTime: 3_600_000,
    refetchOnWindowFocus: false,
  });

  const cpaUpdate = data?.current && data.latest && newer(data.latest, data.current) ? data.latest : null;

  return (
    <div className="space-y-1 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-1">
        <span>面板版本</span>
        <span className="font-mono text-foreground">{FRONTEND_VERSION}</span>
      </div>
      <div className="flex items-center justify-between gap-1">
        <span>CPA 版本</span>
        {cpaUpdate ? (
          <a
            href="https://github.com/router-for-me/CLIProxyAPI/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-chart-1 hover:underline"
            title={`可更新到 ${cpaUpdate}`}
          >
            <ArrowUpCircle className="size-3" />
            {data?.current} → {cpaUpdate}
          </a>
        ) : (
          <span className="font-mono text-foreground">{data?.current || "—"}</span>
        )}
      </div>
    </div>
  );
}

export function Layout() {
  const logout = useLogout();
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-8 items-center gap-2 px-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Logo className="size-5 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">CPA Dashboard</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="概览" items={OVERVIEW_NAV} />
          <NavGroup label="网关接入" items={GATEWAY_NAV} />
          <NavGroup label="模型服务" items={MODEL_NAV} />
          <NavGroup label="系统运维" items={SYSTEM_NAV} />
        </SidebarContent>
        <SidebarFooter>
          <VersionInfo />
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
  );
}
