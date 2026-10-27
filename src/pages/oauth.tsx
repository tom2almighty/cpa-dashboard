import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, LogIn, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useCopiedState } from "@/hooks/use-copied-state";
import { useI18n } from "@/i18n/context";
import { api, errorText } from "@/lib/api";
import { CREDENTIALS_KEY } from "@/lib/credentials";

type Provider = { id: string; name: string; hintKey: string; plugin?: boolean };

// 与官方面板一致：只有浏览器回调流程需要后端在 CPA 主机上监听回调端口。
const WEBUI_SUPPORTED = new Set(["codex", "claude", "antigravity", "xai", "devin"]);

// 这些提供方支持登录会话代理；其余内置与插件提供方都按会话代理处理
const PROXY_SUPPORTED = new Set(["codex", "claude", "antigravity", "xai", "devin", "kimi", "kimi-ai", "meta"]);

// 回调还是设备码流程由 auth-url 返回的 flow 决定
const PROVIDERS: Provider[] = [
  { id: "codex", name: "Codex", hintKey: "oauth.hints.codex" },
  { id: "claude", name: "Claude", hintKey: "oauth.hints.anthropic" },
  { id: "antigravity", name: "Antigravity", hintKey: "oauth.hints.antigravity" },
  { id: "xai", name: "xAI Grok", hintKey: "oauth.hints.xai" },
  { id: "devin", name: "Devin", hintKey: "oauth.hints.devin" },
  { id: "kimi", name: "Kimi", hintKey: "oauth.hints.kimi" },
  { id: "kimi-ai", name: "Kimi.ai", hintKey: "oauth.hints.kimi-ai" },
  { id: "meta", name: "Muse (Meta)", hintKey: "oauth.hints.meta" },
];

type Session = { url: string; state: string; flow?: string; user_code?: string; expires_in?: number };

type PluginList = {
  plugins?: { id: string; supports_oauth?: boolean; oauth_provider?: string; metadata?: { name?: string } }[];
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const { copied, mark } = useCopiedState(1500);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        mark(text);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? t("common.copied") : label}
    </Button>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<(Session & { deadline?: number }) | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [now, setNow] = useState(Date.now);
  const expired = session?.deadline !== undefined && now >= session.deadline;
  const supportsProxy = provider.plugin || PROXY_SUPPORTED.has(provider.id);

  const start = useMutation({
    mutationFn: () => {
      // 代理只能在请求体里传;is_webui 让 CPA 在本机监听回调端口,设备码与插件流程不需要
      const body: { provider: string; proxy_url?: string; is_webui?: boolean } = { provider: provider.id };
      if (supportsProxy && proxyUrl.trim()) body.proxy_url = proxyUrl.trim();
      if (!provider.plugin && WEBUI_SUPPORTED.has(provider.id)) body.is_webui = true;
      return api<Session>("/v8/management/oauth/auth-url", { method: "POST", body });
    },
    onSuccess: (data) => {
      setNow(Date.now());
      setSession({ ...data, deadline: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined });
      setCallbackUrl("");
    },
  });

  // 设备码有效期倒计时,过期后停止轮询
  useEffect(() => {
    if (!session?.deadline || expired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.deadline, expired]);

  const status = useQuery({
    queryKey: ["oauth-status", session?.state],
    queryFn: () =>
      api<{ status: "wait" | "ok" | "error"; error?: string }>(
        `/v8/management/oauth/status?state=${encodeURIComponent(session?.state ?? "")}`,
      ),
    enabled: Boolean(session?.state) && !expired,
    refetchInterval: (query) => (query.state.data?.status === "wait" || !query.state.data ? 2000 : false),
    refetchOnWindowFocus: false,
  });

  const done = status.data?.status === "ok";
  const failed = status.data?.status === "error";

  useEffect(() => {
    if (!done) return;
    toast.success(t("oauth.login_success", { name: provider.name }));
    queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
    setSession(null);
  }, [done, provider.name, queryClient, t]);

  const submit = useMutation({
    mutationFn: () =>
      api("/v8/management/oauth/callback", {
        method: "POST",
        body: { provider: provider.id, state: session?.state, redirect_url: callbackUrl.trim() },
      }),
    onSuccess: () => toast.success(t("oauth.callback_submitted")),
  });

  const cancel = useMutation({
    mutationFn: () =>
      api(`/v8/management/oauth/session?state=${encodeURIComponent(session?.state ?? "")}`, { method: "DELETE" }),
    onSettled: () => setSession(null),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (callbackUrl.trim()) submit.mutate();
  }

  const secondsLeft = session?.deadline ? Math.max(0, Math.ceil((session.deadline - now) / 1000)) : 0;

  return (
    <section aria-labelledby={`oauth-${provider.id}`} className="grid content-start gap-4 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`oauth-${provider.id}`} className="font-medium">
            {provider.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(provider.hintKey as never)}</p>
        </div>
        {session ? (
          <Button variant="ghost" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            <X />
            {t("oauth.cancel_login")}
          </Button>
        ) : (
          <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? <Spinner /> : <LogIn />}
            {t("oauth.login_btn")}
          </Button>
        )}
      </div>

      {!session && supportsProxy && (
        <div className="grid gap-1.5">
          <Label htmlFor={`proxy-${provider.id}`} className="text-xs text-muted-foreground">
            {t("oauth.proxy_label")}
          </Label>
          <Input
            id={`proxy-${provider.id}`}
            value={proxyUrl}
            onChange={(e) => {
              setProxyUrl(e.target.value);
              if (start.isError) start.reset();
            }}
            placeholder={t("oauth.proxy_placeholder")}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}
      {start.isError && <p className="text-xs text-destructive">{errorText(start.error)}</p>}

      {session && (
        <div className="grid gap-4 border-t pt-4">
          <div className="grid gap-2">
            <span className="text-sm text-muted-foreground">
              {session.user_code ? t("oauth.open_device_hint") : t("oauth.open_auth_hint")}
            </span>
            {session.user_code && (
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">
                  {session.user_code}
                </code>
                <CopyButton text={session.user_code} label={t("oauth.copy_code")} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<a href={session.url} target="_blank" rel="noreferrer" />}>
                <ExternalLink />
                {t("oauth.open_auth_page")}
              </Button>
              <CopyButton text={session.url} label={t("oauth.copy_url")} />
            </div>
          </div>

          {session.flow !== "device" && !done && (
            <form onSubmit={onSubmit} className="grid gap-2">
              <Label htmlFor={`callback-${provider.id}`}>{t("oauth.callback_label")}</Label>
              <div className="flex gap-2">
                <Input
                  id={`callback-${provider.id}`}
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="http://localhost:…/callback?code=…"
                />
                <Button type="submit" variant="outline" disabled={!callbackUrl.trim() || submit.isPending}>
                  {t("oauth.submit_callback")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("oauth.callback_explain")}</p>
            </form>
          )}

          <p
            role="status"
            className={
              failed || expired ? "text-sm text-destructive" : "flex items-center gap-2 text-sm text-muted-foreground"
            }
          >
            {failed ? (
              `${t("oauth.login_failed")}${status.data?.error ?? t("oauth.unknown_error")}`
            ) : expired ? (
              t("oauth.code_expired")
            ) : (
              <>
                <Spinner />
                {t("oauth.waiting_auth")}
                {session.deadline !== undefined && (
                  <span className="tabular-nums">
                    {t("oauth.code_expires_in", {
                      time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`,
                    })}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

export function OAuthPage() {
  const { t } = useI18n();
  const plugins = useQuery({
    queryKey: ["cpa", "plugins"],
    queryFn: () => api<PluginList>("/v8/management/plugins"),
    retry: false,
  });
  const builtIn = new Set(PROVIDERS.map((p) => p.id));
  const pluginProviders: Provider[] = (plugins.data?.plugins ?? [])
    .filter((p) => p.supports_oauth && !builtIn.has(p.oauth_provider || p.id))
    .map((p) => ({
      id: p.oauth_provider || p.id,
      name: p.metadata?.name || p.id,
      hintKey: "oauth.plugin_provider_hint",
      plugin: true,
    }));

  return (
    <>
      <PageHeader title={t("oauth.title")} description={t("oauth.desc")} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...PROVIDERS, ...pluginProviders].map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </>
  );
}
