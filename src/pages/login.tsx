import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Globe, Server } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api, clearBaseUrl, clearKey, saveBaseUrl, saveKey, storedBaseUrl, storedKey } from "@/lib/api";

function detectDefaultBase(): string {
  try {
    const { protocol, hostname, port } = window.location;
    const normalizedPort = port ? `:${port}` : "";
    return `${protocol}//${hostname}${normalizedPort}`;
  } catch {
    return "http://localhost:8317";
  }
}

async function login(base: string, key: string, remember: boolean) {
  // 保存选中的地址和密钥
  saveBaseUrl(base, remember);
  saveKey(key, remember);

  try {
    await api("/v0/management/debug");
  } catch (error) {
    clearKey();
    if (!remember) clearBaseUrl();
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError(401, "管理密钥不正确");
    }
    if (error instanceof ApiError && error.status === 403) {
      throw new ApiError(403, "CPA 不允许远程管理，需要在配置中设置 remote-management.allow-remote: true");
    }
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(404, "CPA 没有开启管理接口，需要在配置中设置 remote-management.secret-key");
    }
    const msg = (error as Error)?.message || String(error);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      throw new ApiError(0, "无法连接到 CPA 服务，请确认 CPA 地址是否正确，且已允许跨域（CORS）或网络可达");
    }
    throw error;
  }
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const detectedBase = useMemo(() => detectDefaultBase(), []);

  const [customBase, setCustomBase] = useState(() => storedBaseUrl());
  const [showCustomBase, setShowCustomBase] = useState(() => Boolean(storedBaseUrl()));
  const [key, setKey] = useState(() => storedKey());
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(true);

  const activeBase = showCustomBase ? customBase.trim() : "";

  const mutation = useMutation({
    mutationFn: () => login(activeBase, key.trim(), remember),
    meta: { quiet: true },
    onSuccess: () => queryClient.setQueryData(["session"], true),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (key.trim()) mutation.mutate();
  }

  return (
    <main className="grid min-h-svh place-items-center px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="size-7" />
          <h1 className="text-xl font-semibold tracking-tight">CPA Dashboard</h1>
        </div>

        {/* CPA 服务地址选择区 */}
        <div className="mb-5 rounded-lg border bg-muted/40 p-3.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Server className="size-3.5 text-muted-foreground" />
              CPA 连接地址
            </span>
            <span className="max-w-44 truncate text-muted-foreground" title={activeBase || `${detectedBase}（当前源）`}>
              {activeBase || `${detectedBase} (默认)`}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Checkbox
              id="toggle-custom-base"
              checked={showCustomBase}
              onCheckedChange={(v) => setShowCustomBase(v === true)}
            />
            <Label
              htmlFor="toggle-custom-base"
              className="cursor-pointer text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              自定义 CPA 服务地址
            </Label>
          </div>

          {showCustomBase && (
            <div className="mt-3 grid gap-2 border-t pt-2.5">
              <Input
                placeholder="例如 http://localhost:8317"
                value={customBase}
                onChange={(e) => setCustomBase(e.target.value)}
                className="h-8 text-xs font-mono"
              />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomBase("http://localhost:8317")}
                  className="h-6 px-2 text-[11px]"
                >
                  <Globe className="mr-1 size-3" />
                  localhost:8317
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomBase("http://127.0.0.1:8317")}
                  className="h-6 px-2 text-[11px]"
                >
                  127.0.0.1:8317
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCustomBase("")}
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                >
                  清空（使用默认）
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                面板独立运行在其他端口或远程静态服务器时，请在此指定 CPA 后端地址。
              </p>
            </div>
          )}
        </div>

        {/* 管理密钥输入区 */}
        <div className="grid gap-2">
          <Label htmlFor="key">管理密钥</Label>
          <div className="relative">
            <Input
              id="key"
              type={showKey ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-invalid={mutation.isError || undefined}
              aria-describedby="key-hint"
              className="pr-9"
              placeholder="请输入 remote-management.secret-key"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? "隐藏密钥" : "显示密钥"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          <p id="key-hint" className="text-xs text-muted-foreground">
            填写 CPA 配置里 remote-management.secret-key 的原文。连续输错 5 次，CPA 会封禁当前 IP 30 分钟。
          </p>
        </div>

        <Label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-normal">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          在这台设备上记住连接信息与密钥（非明文安全存储）
        </Label>

        {mutation.isError && (
          <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
            {mutation.error.message}
          </p>
        )}

        <Button type="submit" size="lg" className="mt-6 w-full" disabled={!key.trim() || mutation.isPending}>
          {mutation.isPending && <Spinner />}
          登录
        </Button>
      </form>
    </main>
  );
}
