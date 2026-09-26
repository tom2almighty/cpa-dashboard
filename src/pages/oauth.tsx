import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, LogIn, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
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
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");

  const start = useMutation({
    mutationFn: () =>
      api<Session>(`/v0/management/${provider.id}-auth-url${provider.callback ? "?is_webui=true" : ""}`),
    onSuccess: (data) => {
      setSession(data);
      setCallbackUrl("");
    },
  });

  const status = useQuery({
    queryKey: ["oauth-status", session?.state],
    queryFn: () =>
      api<{ status: "wait" | "ok" | "error"; error?: string }>(
        `/v0/management/get-auth-status?state=${encodeURIComponent(session?.state ?? "")}`,
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
    queryClient.invalidateQueries({ queryKey: ["cpa", "auth-files"] });
    setSession(null);
  }, [done, provider.name, queryClient]);

  const submit = useMutation({
    mutationFn: () =>
      api("/v0/management/oauth-callback", {
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
      api(`/v0/management/oauth-session?state=${encodeURIComponent(session?.state ?? "")}`, { method: "DELETE" }),
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
          <p className="mt-1 text-sm text-muted-foreground">{provider.hint}</p>
        </div>
        {session ? (
          <Button variant="ghost" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            <X />
            取消
          </Button>
        ) : (
          <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? <Spinner /> : <LogIn />}
            登录
          </Button>
        )}
      </div>

      {session && (
        <div className="grid gap-4 border-t pt-4">
          <div className="grid gap-2">
            <span className="text-sm text-muted-foreground">
              {session.user_code ? "打开授权页面并输入设备码" : "打开授权页面完成登录"}
            </span>
            {session.user_code && (
              <div className="flex items-center gap-3">
                <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">
                  {session.user_code}
                </code>
                <CopyButton text={session.user_code} label="复制设备码" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<a href={session.url} target="_blank" rel="noreferrer" />}>
                <ExternalLink />
                打开授权页面
              </Button>
              <CopyButton text={session.url} label="复制链接" />
            </div>
          </div>

          {provider.callback && !done && (
            <form onSubmit={onSubmit} className="grid gap-2">
              <Label htmlFor={`callback-${provider.id}`}>回调地址</Label>
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
                  提交
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                授权后浏览器会跳转到 localhost，CPA 不在本机时页面会打不开，把地址栏里的完整地址粘贴到这里即可。
              </p>
            </form>
          )}

          <p
            role="status"
            className={failed ? "text-sm text-destructive" : "flex items-center gap-2 text-sm text-muted-foreground"}
          >
            {failed ? (
              `登录失败：${status.data?.error ?? "未知错误"}`
            ) : (
              <>
                <Spinner />
                等待授权完成
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

export function OAuthPage() {
  const plugins = useQuery({
    queryKey: ["cpa", "plugins"],
    queryFn: () => api<PluginList>("/v0/management/plugins"),
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
      <PageHeader title="OAuth 登录" description="登录成功后，CPA 会把认证文件保存到认证目录，可在认证文件页查看。" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...PROVIDERS, ...pluginProviders].map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </>
  );
}
