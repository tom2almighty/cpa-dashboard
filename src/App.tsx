import { useQuery } from "@tanstack/react-query";
import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout } from "@/components/layout";
import { Spinner } from "@/components/ui/spinner";
import { api, isUnauthorized } from "@/lib/api";
import { LoginPage } from "@/pages/login";

const OverviewPage = lazy(() => import("@/pages/overview").then((m) => ({ default: m.OverviewPage })));
const UsagePage = lazy(() => import("@/pages/usage").then((m) => ({ default: m.UsagePage })));
const PricesPage = lazy(() => import("@/pages/prices").then((m) => ({ default: m.PricesPage })));
const AccountsPage = lazy(() => import("@/pages/accounts").then((m) => ({ default: m.AccountsPage })));
const ConfigPage = lazy(() => import("@/pages/config").then((m) => ({ default: m.ConfigPage })));

export function App() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        await api("/api/session");
        return true;
      } catch (error) {
        if (isUnauthorized(error)) return false;
        throw error;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

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
        <Route index element={<OverviewPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="prices" element={<PricesPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
