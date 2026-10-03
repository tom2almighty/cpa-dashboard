import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Puzzle, RefreshCw, Settings2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { fetchPlugins, PLUGINS_KEY, resolvePluginMenuUrl } from "@/lib/plugins";

export function PluginViewPage() {
  const { pluginId = "" } = useParams<{ pluginId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);

  const { data, isPending } = useQuery({
    queryKey: PLUGINS_KEY,
    queryFn: fetchPlugins,
    staleTime: 60_000,
  });

  const plugin = data?.plugins?.find((p) => p.id === pluginId);
  const menus = plugin?.menus?.filter((m) => Boolean(m.path)) ?? [];

  const currentPath = searchParams.get("path") || menus[0]?.path || "";
  const activeMenu = menus.find((m) => m.path === currentPath) || menus[0];
  const resolvedUrl = plugin && activeMenu ? resolvePluginMenuUrl(plugin.id, activeMenu.path) : "";

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!plugin || plugin.effective_enabled === false || !activeMenu) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("plugins.view_title")} description={t("plugins.view_desc")} />
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Puzzle className="size-10 text-muted-foreground/60" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("plugins.view_not_found")}</p>
              <p className="text-xs text-muted-foreground">{t("plugins.view_not_found_hint")}</p>
            </div>
            <Button variant="outline" size="sm" render={<Link to="/plugins" />}>
              <Settings2 className="size-3.5" />
              {t("nav.plugins")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const title = activeMenu.menu || plugin.metadata?.name || plugin.id;
  const description = activeMenu.description || plugin.metadata?.author || plugin.id;

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            {menus.length > 1 && (
              <Select
                value={activeMenu.path}
                onValueChange={(path) => {
                  if (path) setSearchParams({ path });
                }}
              >
                <SelectTrigger className="h-8 text-xs min-w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {menus.map((m) => (
                    <SelectItem key={m.path} value={m.path}>
                      {m.menu || m.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              title={t("plugins.reload_page")}
              aria-label={t("plugins.reload_page")}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw className="size-3.5" />
              <span className="hidden sm:inline">{t("common.refresh")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              title={t("plugins.open_in_new_tab")}
              aria-label={t("plugins.open_in_new_tab")}
              render={
                <a href={resolvedUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  <span className="hidden sm:inline">{t("plugins.open_in_new_tab")}</span>
                </a>
              }
            />
          </div>
        }
      />

      <div className="relative w-full rounded-xl border bg-background overflow-hidden h-[calc(100vh-13rem)] min-h-125 shadow-2xs">
        <iframe
          key={reloadKey}
          src={resolvedUrl}
          title={title}
          className="size-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        />
      </div>
    </div>
  );
}
