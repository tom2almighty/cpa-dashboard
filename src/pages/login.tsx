import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Eye, EyeOff, Globe, Server } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
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

async function login(base: string, key: string, remember: boolean, t: TFunction) {
  // 保存选中的地址和密钥
  saveBaseUrl(base, remember);
  saveKey(key, remember);

  try {
    await api("/v8/management/config/config-version");
  } catch (error) {
    clearKey();
    if (!remember) clearBaseUrl();
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError(401, t("login.error_unauthorized"));
    }
    // 403 还可能是 IP 因多次失败被临时封禁,此时直接展示 CPA 返回的原因
    if (error instanceof ApiError && error.code === "remote management disabled") {
      throw new ApiError(403, t("login.error_forbidden"));
    }
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(404, t("login.error_not_found"));
    }
    const msg = (error as Error)?.message || String(error);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      throw new ApiError(0, t("login.error_network"));
    }
    throw error;
  }
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const detectedBase = useMemo(() => detectDefaultBase(), []);
  const [customBase, setCustomBase] = useState(() => storedBaseUrl());
  const [showCustomBase, setShowCustomBase] = useState(() => Boolean(storedBaseUrl()));
  const [key, setKey] = useState(() => storedKey());
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(true);

  const activeBase = showCustomBase ? customBase.trim() : "";

  const mutation = useMutation({
    mutationFn: () => login(activeBase, key.trim(), remember, t),
    meta: { quiet: true },
    onSuccess: () => queryClient.setQueryData(["session"], true),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (key.trim()) mutation.mutate();
  }

  return (
    <main className="relative grid min-h-svh place-items-center px-4 py-8">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LanguageToggle mode="button" />
        <ThemeToggle mode="button" />
      </div>
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="size-7" />
          <h1 className="text-xl font-semibold tracking-tight">{t("login.title")}</h1>
        </div>

        {/* CPA 服务地址选择区 */}
        <div className="mb-5 rounded-lg border bg-muted/40 p-3.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Server className="size-3.5 text-muted-foreground" />
              {t("login.server_address")}
            </span>
            <span
              className="max-w-44 truncate text-muted-foreground"
              title={activeBase || `${detectedBase} (${t("login.current_origin")})`}
            >
              {activeBase || `${detectedBase} (${t("login.default")})`}
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
              {t("login.custom_base_toggle")}
            </Label>
          </div>

          {showCustomBase && (
            <div className="mt-3 grid gap-2 border-t pt-2.5">
              <Input
                placeholder={t("login.custom_base_placeholder")}
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
                  {t("login.clear_custom_base")}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("login.remote_hint")}</p>
            </div>
          )}
        </div>

        {/* 管理密钥输入区 */}
        <div className="grid gap-2">
          <Label htmlFor="key">{t("login.secret_key")}</Label>
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
              placeholder={t("login.secret_key_placeholder")}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? t("login.hide_key") : t("login.show_key")}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          <p id="key-hint" className="text-xs text-muted-foreground">
            {t("login.secret_key_hint")}
          </p>
        </div>

        <Label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-normal">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          {t("login.remember_me")}
        </Label>

        {mutation.isError && (
          <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
            {mutation.error.message}
          </p>
        )}

        <Button type="submit" size="lg" className="mt-6 w-full" disabled={!key.trim() || mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
    </main>
  );
}
