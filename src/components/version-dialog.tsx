import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, Info, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { request } from "@/lib/api";

declare const __APP_VERSION__: string | undefined;
const FRONTEND_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";
const GITHUB_REPO = "tom2almighty/cpa-dashboard";

function newer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).map(Number);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

type GitHubRelease = {
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  published_at?: string;
  assets?: { name: string; browser_download_url: string; size: number }[];
};

export function useVersionData() {
  const cpaQuery = useQuery({
    queryKey: ["cpa", "version"],
    queryFn: async () => {
      const res = await request("/v0/management/latest-version");
      const body = res.ok ? ((await res.json().catch(() => ({}))) as { "latest-version"?: string }) : {};
      return {
        current: res.headers.get("x-cpa-version") || "未知",
        latest: body["latest-version"] ?? null,
      };
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
  });

  const panelReleaseQuery = useQuery({
    queryKey: ["panel", "latest-release"],
    queryFn: async () => {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { "User-Agent": "cpa-dashboard" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`查询 GitHub Release 失败 (${res.status})`);
      return (await res.json()) as GitHubRelease;
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
  });

  const cpaCurrent = cpaQuery.data?.current || "未知";
  const cpaLatest = cpaQuery.data?.latest;
  const cpaHasUpdate = Boolean(cpaLatest && newer(cpaLatest, cpaCurrent));

  const panelLatest = panelReleaseQuery.data?.tag_name;
  const currentVersion = FRONTEND_VERSION || panelLatest || "";
  const panelHasUpdate = Boolean(panelLatest && currentVersion && newer(panelLatest, currentVersion));

  const hasAnyUpdate = cpaHasUpdate || panelHasUpdate;

  return {
    cpaQuery,
    panelReleaseQuery,
    cpaCurrent,
    cpaLatest,
    cpaHasUpdate,
    panelLatest,
    panelHasUpdate,
    currentVersion,
    hasAnyUpdate,
  };
}

export function VersionCardContent() {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const { panelReleaseQuery, cpaCurrent, cpaLatest, cpaHasUpdate, panelLatest, panelHasUpdate, currentVersion } =
    useVersionData();
  const handleCheckUpdates = async () => {
    setChecking(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["cpa", "version"] }),
      queryClient.invalidateQueries({ queryKey: ["panel", "latest-release"] }),
    ]);
    setChecking(false);
    toast.success("已完成最新版本检查");
  };

  const managementAsset = panelReleaseQuery.data?.assets?.find((a) => a.name === "management.html");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <p className="text-xs text-muted-foreground">定期检查 GitHub 与 CPA 后端版本，保持管理功能与安全更新。</p>
        <Button variant="outline" size="sm" onClick={handleCheckUpdates} disabled={checking}>
          {checking ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          立即检查更新
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* 前端面板版本 */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">前端管理面板</CardTitle>
              </div>
              {panelHasUpdate ? (
                <Badge variant="default" className="text-[10px] h-5 bg-chart-1 gap-1">
                  <ArrowUpCircle className="size-3" />
                  可更新
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground gap-1">
                  <CheckCircle2 className="size-3 text-chart-1" />
                  已是最新
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">单文件发布版 (management.html)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">当前运行版本:</span>
              <span className="font-mono font-medium">{currentVersion || "未知"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最新发行版本:</span>
              <span className="font-mono font-medium">{panelLatest || "检查中..."}</span>
            </div>

            {panelHasUpdate && (
              <div className="mt-3 rounded-lg border border-chart-1/30 bg-chart-1/5 p-2.5 space-y-2">
                <p className="font-medium text-chart-1">发现新版本 {panelLatest}！</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  若已在 CPA 的 <code className="text-foreground font-mono">config.yaml</code> 中配置了{" "}
                  <code className="text-foreground font-mono">panel-github-repository</code>
                  ，CPA 后台会自动定时静默拉取最新单文件并热生效，无需手动下载。若急需立即生效，重启 CPA
                  服务即可触发即时同步。
                </p>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <Button
                    size="xs"
                    nativeButton={false}
                    render={<a href={panelReleaseQuery.data?.html_url} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink className="size-3" />
                    查看 Release 更新日志
                  </Button>
                  {managementAsset && (
                    <Button
                      variant="outline"
                      size="xs"
                      nativeButton={false}
                      render={<a href={managementAsset.browser_download_url} download="management.html" />}
                    >
                      <Download className="size-3" />
                      手动下载备用
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 后端 CPA 版本 */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Info className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">后端服务 (CLIProxyAPI)</CardTitle>
              </div>
              {cpaHasUpdate ? (
                <Badge variant="default" className="text-[10px] h-5 bg-chart-1 gap-1">
                  <ArrowUpCircle className="size-3" />
                  可更新
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground gap-1">
                  <CheckCircle2 className="size-3 text-chart-1" />
                  已是最新
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">CPA 代理核心网关引擎</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">当前运行版本:</span>
              <span className="font-mono font-medium">{cpaCurrent}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最新官方版本:</span>
              <span className="font-mono font-medium">{cpaLatest || "检查中..."}</span>
            </div>

            {cpaHasUpdate && (
              <div className="mt-3 rounded-lg border border-chart-1/30 bg-chart-1/5 p-2.5 space-y-2">
                <p className="font-medium text-chart-1">CPA 可升级至 {cpaLatest}！</p>
                <Button
                  variant="outline"
                  size="xs"
                  nativeButton={false}
                  render={
                    <a
                      href="https://github.com/router-for-me/CLIProxyAPI/releases/latest"
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-3" />
                  CPA 官方 Release
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* CPA 自动拉取更新说明 */}
      <Card className="bg-muted/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            面板自动拉取更新配置 (CPA config.yaml)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p>
            CPA 后端内置自动拉取机制。配置了 <code className="font-mono text-foreground">panel-github-repository</code>{" "}
            后，CPA 会自动检测本仓库的 Release 并更新 <code className="font-mono text-foreground">management.html</code>
            ：
          </p>
          <pre className="rounded bg-muted/60 p-2 font-mono text-[11px] text-foreground">
            {`remote-management:
  panel-github-repository: "https://github.com/${GITHUB_REPO}"
  disable-auto-update-panel: false # 为 false 时 CPA 后台会自动拉取最新 Release`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

export function VersionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <DialogTitle>版本信息与更新中心</DialogTitle>
          </div>
          <DialogDescription className="text-xs">查看并拉取前端面板与 CPA 代理服务的最新版本。</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <VersionCardContent />
        </div>
      </DialogContent>
    </Dialog>
  );
}
