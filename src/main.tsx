import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "@/App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/context";
import { ApiError, CONFIG_KEY, isUnauthorized } from "@/lib/api";
import { showError } from "@/lib/toast";
import "./index.css";

// 登录失效时把会话标记为未登录,App 会切回登录页
function onError(error: Error) {
  if (isUnauthorized(error)) queryClient.setQueryData(["session"], false);
  // 配置被其它会话改过:缓存已经不可信,刷新后再让用户重试
  if (error instanceof ApiError && error.code === "precondition_failed") {
    void queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({
    // 自己在界面上展示错误的操作设置 meta.quiet,避免重复提示
    onError: (error, _variables, _context, mutation) => {
      onError(error);
      if (!isUnauthorized(error) && !mutation.meta?.quiet) showError(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !isUnauthorized(error) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

// 面板由 CPA 以 /management.html 提供,刷新时只能靠 hash 保留路由
const root = document.getElementById("root");
if (!root) throw new Error("缺少 #root 节点");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster position="top-center" />
          </TooltipProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
