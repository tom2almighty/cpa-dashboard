import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router";
import { toast } from "sonner";
import { App } from "@/App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isUnauthorized } from "@/lib/api";
import { LITE } from "@/lib/mode";
import "./index.css";

// 登录失效时把会话标记为未登录,App 会切回登录页
function onError(error: Error) {
  if (isUnauthorized(error)) queryClient.setQueryData(["session"], false);
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({
    // 自己在界面上展示错误的操作设置 meta.quiet,避免重复提示
    onError: (error, _variables, _context, mutation) => {
      onError(error);
      if (!isUnauthorized(error) && !mutation.meta?.quiet) toast.error(error.message);
    },
  }),
  defaultOptions: {
    queries: { retry: (count, error) => !isUnauthorized(error) && count < 2, refetchOnWindowFocus: true },
  },
});

// 精简版由 CPA 以 /management.html 提供,刷新时只能靠 hash 保留路由
const Router = LITE ? HashRouter : BrowserRouter;

const root = document.getElementById("root");
if (!root) throw new Error("缺少 #root 节点");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router>
            <App />
          </Router>
          <Toaster position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
