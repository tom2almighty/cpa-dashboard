import {
  Activity,
  Boxes,
  FileCog,
  FileKey,
  KeyRound,
  KeySquare,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
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
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useVersionData, VersionDialog } from "@/components/version-dialog";
import { useLogout } from "@/hooks/use-logout";
import { useI18n } from "@/i18n/context";

type NavItemDef = { to: string; labelKey: string; icon: typeof FileKey };

const OVERVIEW_NAV: NavItemDef[] = [{ to: "/", labelKey: "nav.overview", icon: Activity }];

const GATEWAY_NAV: NavItemDef[] = [
  { to: "/auth-files", labelKey: "nav.auth_files", icon: FileKey },
  { to: "/oauth", labelKey: "nav.oauth", icon: KeySquare },
  { to: "/providers", labelKey: "nav.providers", icon: Network },
  { to: "/api-keys", labelKey: "nav.api_keys", icon: KeyRound },
];

const MODEL_NAV: NavItemDef[] = [{ to: "/models", labelKey: "nav.models", icon: Boxes }];

const SYSTEM_NAV: NavItemDef[] = [
  { to: "/plugins", labelKey: "nav.plugins", icon: Puzzle },
  { to: "/logs", labelKey: "nav.logs", icon: ScrollText },
  { to: "/config", labelKey: "nav.config", icon: FileCog },
];

function NavGroup({ label, items }: { label: string; items: NavItemDef[] }) {
  const { pathname } = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();
  const { t } = useI18n();
  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)}
                tooltip={t(item.labelKey)}
                onClick={handleNavClick}
                render={<NavLink to={item.to} end={item.to === "/"} />}
              >
                <item.icon />
                <span>{t(item.labelKey)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// 桌面端收起/展开,收起后只保留图标;快捷键 Ctrl/⌘ + B
function HeaderCollapseButton() {
  const { state, toggleSidebar } = useSidebar();
  const { t } = useI18n();
  const collapsed = state === "collapsed";
  const label = collapsed ? t("footer.expand_sidebar") : t("footer.collapse_sidebar");
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={label}
      aria-label={label}
      onClick={toggleSidebar}
      className="hidden md:inline-flex text-muted-foreground hover:text-foreground shrink-0 group-data-[collapsible=icon]:mt-1"
    >
      {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
    </Button>
  );
}

export function Layout() {
  const logout = useLogout();
  const { t } = useI18n();
  const [openVersion, setOpenVersion] = useState(false);
  const { hasAnyUpdate } = useVersionData();
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="flex flex-row items-center justify-between group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 p-2">
          <NavLink
            to="/"
            className="flex h-8 items-center gap-2 px-1 font-semibold transition-opacity hover:opacity-80 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            title="返回首页"
          >
            <Logo className="size-5 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">CPA Dashboard</span>
          </NavLink>
          <HeaderCollapseButton />
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label={t("nav.overview_group")} items={OVERVIEW_NAV} />
          <NavGroup label={t("nav.gateway_group")} items={GATEWAY_NAV} />
          <NavGroup label={t("nav.models_group")} items={MODEL_NAV} />
          <NavGroup label={t("nav.system_group")} items={SYSTEM_NAV} />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t("version.title")}
                onClick={() => setOpenVersion(true)}
                className="justify-between group-data-[collapsible=icon]:justify-center"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="size-4 shrink-0 text-primary" />
                  <span className="truncate text-xs group-data-[collapsible=icon]:hidden">{t("version.title")}</span>
                </div>
                {hasAnyUpdate && (
                  <span className="size-1.5 rounded-full bg-primary shrink-0 group-data-[collapsible=icon]:hidden" />
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <LanguageToggle />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <ThemeToggle />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t("footer.logout")} onClick={() => logout.mutate()}>
                <LogOut />
                <span>{t("footer.logout")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail title={t("footer.collapse_sidebar")} aria-label={t("footer.collapse_sidebar")} />
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
