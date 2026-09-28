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

type Provider = { id: string; name: string; hint: string; callback: boolean };

// callback:浏览器授权后跳回 localhost 回调;其余为设备码流程
const PROVIDERS: Provider[] = [
  { id: "codex", name: "Codex", hint: "使用 ChatGPT 账号登录", callback: true },
  { id: "anthropic", name: "Claude", hint: "使用 Claude.ai 账号登录", callback: true },
  { id: "antigravity", name: "Antigravity", hint: "使用 Google 账号登录", callback: true },
  { id: "xai", name: "xAI Grok", hint: "使用 Grok 账号登录", callback: true },
  { id: "devin", name: "Devin", hint: "需要 CPA 7.3.1 或更高版本，请在 5 分钟内完成授权", callback: true },
  { id: "kimi", name: "Kimi", hint: "使用 Kimi 国内账号登录（kimi.com，设备码）", callback: false },
  { id: "kimi-ai", name: "Kimi.ai", hint: "使用 Kimi 国际账号登录（kimi.ai，设备码）", callback: false },
  { id: "meta", name: "Muse (Meta)", hint: "设备码登录", callback: false },
];

type Session = { url: string; state: string; user_code?: string; flow?: string };

type PluginList = {
  plugins?: { id: string; supports_oauth?: boolean; oauth_provider?: string; metadata?: { name?: string } }[];
};

// xAI 页面有时只显示 code,需要拼成 CPA 认可的回调地址
function resolveCallback(provider: string, input: string, state: string): string {
  const value = input.trim();
  if (provider !== "xai" || /^https?:\/\//i.test(value)) return value;
  const params = new URLSearchParams(value.includes("=") ? value.replace(/^.*?[?#]/, "") : `code=${value}`);
  if (!params.get("state")) params.set("state", state);
  return `http://127.0.0.1:56121/callback?${params}`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
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
      {copied ? "已复制" : label}
    </Button>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const start = useMutation({
    mutationFn: () =>
      api<Session>(
        `/v8/management/oauth/auth-url?provider=${encodeURIComponent(provider.id)}${provider.callback ? "&is_webui=true" : ""}`,
      ),
    onSuccess: (data) => {
      setSession(data);
      setCallbackUrl("");
    },
  });

  const status = useQuery({
    queryKey: ["oauth-status", session?.state],
    queryFn: () =>
      api<{ status: "wait" | "ok" | "error"; error?: string }>(
        `/v8/management/oauth/status?state=${encodeURIComponent(session?.state ?? "")}`,
      ),
    enabled: Boolean(session?.state),
    refetchInterval: (query) => (query.state.data?.status === "wait" || !query.state.data ? 2000 : false),
    refetchOnWindowFocus: false,
  });

  const done = status.data?.status === "ok";
  const failed = status.data?.status === "error";

  useEffect(() => {
    if (!done) return;
    toast.success(`${provider.name} 登录成功，认证文件已保存`);
    queryClient.invalidateQueries({ queryKey: ["cpa", "credentials"] });
    queryClient.invalidateQueries({ queryKey: ["cpa", "auth-files"] });
    setSession(null);
  }, [done, provider.name, queryClient]);

  const submit = useMutation({
    mutationFn: () =>
      api("/v8/management/oauth/callback", {
        method: "POST",
        body: {
          provider: provider.id,
          state: session?.state,
          redirect_url: resolveCallback(provider.id, callbackUrl, session?.state ?? ""),
        },
      }),
    onSuccess: () => toast.success("回调已提交，等待 CPA 完成登录"),
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

  return (
    <section aria-labelledby={`oauth-${provider.id}`} className="grid content-start gap-4 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`oauth-${provider.id}`} className="font-medium">
            {provider.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(`oauth.hints.${provider.id}`) || provider.hint}</p>
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
              <div className="flex items-center gap-3">
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

          {provider.callback && !done && (
            <form onSubmit={onSubmit} className="grid gap-2">
              <Label htmlFor={`callback-${provider.id}`}>{t("oauth.callback_label")}</Label>
              <div className="flex gap-2">
                <Input
                  id={`callback-${provider.id}`}
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder={
                    provider.id === "xai" ? "完整回调地址或页面显示的 code" : "http://localhost:…/callback?code=…"
                  }
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
            className={failed ? "text-sm text-destructive" : "flex items-center gap-2 text-sm text-muted-foreground"}
          >
            {failed ? (
              `${t("oauth.login_failed")}${status.data?.error ?? "unknown error"}`
            ) : (
              <>
                <Spinner />
                {t("oauth.waiting_auth")}
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
      hint: "插件提供的登录方式",
      callback: false,
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
