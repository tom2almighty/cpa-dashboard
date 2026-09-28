import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, LogIn, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { api } from "@/lib/api";

type Provider = { id: string; name: string; hintKey: string; plugin?: boolean };

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
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
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
  const [now, setNow] = useState(Date.now);
  const expired = session?.deadline !== undefined && now >= session.deadline;

  const start = useMutation({
    mutationFn: () =>
      // is_webui 让 CPA 在本机监听回调端口;插件会把额外参数当作登录元数据,不带
      api<Session>(
        `/v8/management/oauth/auth-url?provider=${encodeURIComponent(provider.id)}${provider.plugin ? "" : "&is_webui=true"}`,
      ),
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
    queryClient.invalidateQueries({ queryKey: ["cpa", "auth-files"] });
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
          <p className="mt-1 text-sm text-muted-foreground">{t(provider.hintKey)}</p>
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
