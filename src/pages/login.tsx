import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

export function LoginPage() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const login = useMutation({
    mutationFn: () => api("/api/session", { method: "POST", body: { key } }),
    onSuccess: () => queryClient.setQueryData(["session"], true),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (key) login.mutate();
  }

  return (
    <main className="grid min-h-svh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-7" />
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
            aria-invalid={login.isError || undefined}
            aria-describedby="key-hint"
          />
          <p id="key-hint" className="text-sm text-muted-foreground">
            填写 CPA 配置里 remote-management.secret-key 的原文。
          </p>
        </div>
        <Button type="submit" size="lg" className="mt-6 w-full" disabled={!key || login.isPending}>
          {login.isPending && <Spinner />}
          登录
        </Button>
      </form>
    </main>
  );
}
