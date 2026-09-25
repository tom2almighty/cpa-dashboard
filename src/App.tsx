import { useQuery } from "@tanstack/react-query";
import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout } from "@/components/layout";
import { Spinner } from "@/components/ui/spinner";
import { api, isUnauthorized, storedKey } from "@/lib/api";
import { LITE } from "@/lib/mode";
import { LoginPage } from "@/pages/login";

// 直接比较 import.meta.env.MODE,构建时会被替换成常量,精简版不会打包用不到的页面
const full =
  import.meta.env.MODE === "lite"
    ? null
    : {
        Overview: lazy(() => import("@/pages/overview").then((m) => ({ default: m.OverviewPage }))),
        Usage: lazy(() => import("@/pages/usage").then((m) => ({ default: m.UsagePage }))),
        Prices: lazy(() => import("@/pages/prices").then((m) => ({ default: m.PricesPage }))),
      };
const StatusPage =
  import.meta.env.MODE === "lite"
    ? lazy(() => import("@/pages/status").then((m) => ({ default: m.StatusPage })))
    : null;
const AccountsPage = lazy(() => import("@/pages/accounts").then((m) => ({ default: m.AccountsPage })));
const ConfigPage = lazy(() => import("@/pages/config").then((m) => ({ default: m.ConfigPage })));
const OAuthPage = lazy(() => import("@/pages/oauth").then((m) => ({ default: m.OAuthPage })));
const ProvidersPage = lazy(() => import("@/pages/providers").then((m) => ({ default: m.ProvidersPage })));
const ModelsPage = lazy(() => import("@/pages/models").then((m) => ({ default: m.ModelsPage })));
const PluginsPage = lazy(() => import("@/pages/plugins").then((m) => ({ default: m.PluginsPage })));
const LogsPage = lazy(() => import("@/pages/logs").then((m) => ({ default: m.LogsPage })));
const ApiKeysPage = lazy(() => import("@/pages/api-keys").then((m) => ({ default: m.ApiKeysPage })));
// 完整版检查后端会话;精简版用保存的管理密钥试探一次 CPA
async function checkSession(): Promise<boolean> {
  if (LITE && !storedKey()) return false;
  try {
    await api(LITE ? "/v0/management/debug" : "/api/session");
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
        {full ? (
          <>
            <Route index element={<full.Overview />} />
            <Route path="usage" element={<full.Usage />} />
            <Route path="prices" element={<full.Prices />} />
          </>
        ) : (
          StatusPage && <Route index element={<StatusPage />} />
        )}
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="oauth" element={<OAuthPage />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="plugins" element={<PluginsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
