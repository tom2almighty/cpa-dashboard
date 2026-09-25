import {
  Activity,
  Boxes,
  FileCog,
  KeyRound,
  KeySquare,
  LogOut,
  Network,
  Puzzle,
  ScrollText,
  Sparkles,
  Users,
} from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
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
import { FRONTEND_VERSION, useVersionData, VersionDialog } from "@/components/version-dialog";
import { useLogout } from "@/hooks/use-logout";

type NavItem = { to: string; label: string; icon: typeof Users };

const OVERVIEW_NAV: NavItem[] = [{ to: "/", label: "运行概览", icon: Activity }];

const GATEWAY_NAV: NavItem[] = [
  { to: "/accounts", label: "账号", icon: Users },
  { to: "/oauth", label: "OAuth 登录", icon: KeySquare },
  { to: "/providers", label: "提供商", icon: Network },
  { to: "/api-keys", label: "API Key", icon: KeyRound },
];

const MODEL_NAV: NavItem[] = [{ to: "/models", label: "可用模型", icon: Boxes }];

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

export function Layout() {
  const logout = useLogout();
  const [openVersion, setOpenVersion] = useState(false);
  const { cpaCurrent, hasAnyUpdate } = useVersionData();
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <NavLink
            to="/"
            className="flex h-8 items-center gap-2 px-2 font-semibold transition-opacity hover:opacity-80 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            title="返回首页"
          >
            <Logo className="size-5 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">CPA Dashboard</span>
          </NavLink>
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="概览" items={OVERVIEW_NAV} />
          <NavGroup label="网关接入" items={GATEWAY_NAV} />
          <NavGroup label="模型服务" items={MODEL_NAV} />
          <NavGroup label="系统运维" items={SYSTEM_NAV} />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="版本与更新中心"
                onClick={() => setOpenVersion(true)}
                className="justify-between group-data-[collapsible=icon]:justify-center"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="size-4 shrink-0 text-primary" />
                  <span className="truncate text-xs font-mono text-muted-foreground group-data-[collapsible=icon]:hidden">
                    {FRONTEND_VERSION} · CPA {cpaCurrent}
                  </span>
                </div>
                {hasAnyUpdate && (
                  <Badge
                    variant="default"
                    className="text-[10px] px-1 py-0 h-4 bg-chart-1 group-data-[collapsible=icon]:hidden"
                  >
                    更新
                  </Badge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
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
          <NavLink to="/" className="flex items-center gap-2 font-semibold transition-opacity hover:opacity-80">
            <Logo className="size-5" />
            <span>CPA Dashboard</span>
          </NavLink>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">
          <Suspense fallback={<Spinner className="mx-auto mt-24 size-6 text-muted-foreground" />}>
            <Outlet />
          </Suspense>
        </main>
      </SidebarInset>
      <VersionDialog open={openVersion} onOpenChange={setOpenVersion} />
    </SidebarProvider>
  );
}
