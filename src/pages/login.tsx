import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api, clearKey, saveKey } from "@/lib/api";
import { LITE } from "@/lib/mode";

async function login(key: string, remember: boolean) {
  if (!LITE) return api("/api/session", { method: "POST", body: { key } });
  saveKey(key, remember);
  try {
    await api("/v0/management/debug");
  } catch (error) {
    clearKey();
    if (error instanceof ApiError && error.status === 401) throw new ApiError(401, "invalid_key", "管理密钥不正确");
    if (error instanceof ApiError && error.status === 403) {
      throw new ApiError(
        403,
        "remote_disabled",
        "CPA 不允许远程管理，需要在配置中设置 remote-management.allow-remote: true",
      );
    }
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        404,
        "management_disabled",
        "CPA 没有开启管理接口，需要在配置中设置 remote-management.secret-key",
      );
    }
    throw error;
  }
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const mutation = useMutation({
    mutationFn: () => login(key, remember),
    meta: { quiet: true },
    onSuccess: () => queryClient.setQueryData(["session"], true),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (key) mutation.mutate();
  }

  return (
    <main className="grid min-h-svh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo className="size-7" />
          <h1 className="text-xl font-semibold tracking-tight">CPA Dashboard</h1>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="key">管理密钥</Label>
          <Input
            id="key"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-invalid={mutation.isError || undefined}
            aria-describedby="key-hint"
          />
          <p id="key-hint" className="text-sm text-muted-foreground">
            填写 CPA 配置里 remote-management.secret-key 的原文。
            {LITE && "连续输错 5 次，CPA 会封禁当前 IP 30 分钟。"}
          </p>
        </div>
        {LITE && (
          <Label className="mt-4 font-normal">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
            在这台设备上记住密钥
          </Label>
        )}
        {mutation.isError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-6 w-full" disabled={!key || mutation.isPending}>
          {mutation.isPending && <Spinner />}
          登录
        </Button>
      </form>
    </main>
  );
}
