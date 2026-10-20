import { useQuery } from "@tanstack/react-query";
import { lazy } from "react";
import { createHashRouter, Navigate, Outlet } from "react-router";
import { Layout } from "@/components/layout";
import { Spinner } from "@/components/ui/spinner";
import { api, isUnauthorized, storedKey } from "@/lib/api";
import { LoginPage } from "@/pages/login";

const StatusPage = lazy(() => import("@/pages/status").then((m) => ({ default: m.StatusPage })));
const AuthFilesPage = lazy(() => import("@/pages/auth-files").then((m) => ({ default: m.AuthFilesPage })));
const ConfigPage = lazy(() => import("@/pages/config").then((m) => ({ default: m.ConfigPage })));
const OAuthPage = lazy(() => import("@/pages/oauth").then((m) => ({ default: m.OAuthPage })));
const ProvidersPage = lazy(() => import("@/pages/providers").then((m) => ({ default: m.ProvidersPage })));
const ModelsPage = lazy(() => import("@/pages/models").then((m) => ({ default: m.ModelsPage })));
const PluginsPage = lazy(() => import("@/pages/plugins").then((m) => ({ default: m.PluginsPage })));
const LogsPage = lazy(() => import("@/pages/logs").then((m) => ({ default: m.LogsPage })));
const ApiKeysPage = lazy(() => import("@/pages/api-keys").then((m) => ({ default: m.ApiKeysPage })));
const PluginViewPage = lazy(() => import("@/pages/plugin-view").then((m) => ({ default: m.PluginViewPage })));

// 用保存的管理密钥试探一次 CPA
async function checkSession(): Promise<boolean> {
  if (!storedKey()) return false;
  try {
    await api("/v8/management/config/config-version");
    return true;
  } catch (error) {
    if (isUnauthorized(error)) return false;
    throw error;
  }
}

function SessionGate() {
  const session = useQuery({ queryKey: ["session"], queryFn: checkSession, staleTime: Number.POSITIVE_INFINITY });

  if (session.isPending) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (session.data !== true) return <LoginPage />;
  return <Outlet />;
}

// 使用 data router,配置页的 useBlocker 才能拦截站内导航
export const router = createHashRouter([
  {
    element: <SessionGate />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <StatusPage /> },
          { path: "auth-files", element: <AuthFilesPage /> },
          { path: "oauth", element: <OAuthPage /> },
          { path: "providers", element: <ProvidersPage /> },
          { path: "api-keys", element: <ApiKeysPage /> },
          { path: "models", element: <ModelsPage /> },
          { path: "plugins", element: <PluginsPage /> },
          { path: "logs", element: <LogsPage /> },
          { path: "plugins/view/:pluginId", element: <PluginViewPage /> },
          { path: "config", element: <ConfigPage /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
