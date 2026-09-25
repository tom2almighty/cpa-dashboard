import { useQuery } from "@tanstack/react-query";
import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout } from "@/components/layout";
import { Spinner } from "@/components/ui/spinner";
import { api, isUnauthorized, storedKey } from "@/lib/api";
import { LoginPage } from "@/pages/login";

const StatusPage = lazy(() => import("@/pages/status").then((m) => ({ default: m.StatusPage })));
const AccountsPage = lazy(() => import("@/pages/accounts").then((m) => ({ default: m.AccountsPage })));
const ConfigPage = lazy(() => import("@/pages/config").then((m) => ({ default: m.ConfigPage })));
const OAuthPage = lazy(() => import("@/pages/oauth").then((m) => ({ default: m.OAuthPage })));
const ProvidersPage = lazy(() => import("@/pages/providers").then((m) => ({ default: m.ProvidersPage })));
const ModelsPage = lazy(() => import("@/pages/models").then((m) => ({ default: m.ModelsPage })));
const PricesPage = lazy(() => import("@/pages/prices").then((m) => ({ default: m.PricesPage })));
const PluginsPage = lazy(() => import("@/pages/plugins").then((m) => ({ default: m.PluginsPage })));
const LogsPage = lazy(() => import("@/pages/logs").then((m) => ({ default: m.LogsPage })));
const ApiKeysPage = lazy(() => import("@/pages/api-keys").then((m) => ({ default: m.ApiKeysPage })));
// 完整版检查后端会话;精简版用保存的管理密钥试探一次 CPA
async function checkSession(): Promise<boolean> {
  if (!storedKey()) return false;
  try {
    await api("/v0/management/debug");
    return true;
  } catch (error) {
    if (isUnauthorized(error)) return false;
    throw error;
  }
}

export function App() {
  const session = useQuery({ queryKey: ["session"], queryFn: checkSession, staleTime: Number.POSITIVE_INFINITY });

  if (session.isPending) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (session.data !== true) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<StatusPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="oauth" element={<OAuthPage />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="prices" element={<PricesPage />} />
        <Route path="plugins" element={<PluginsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
