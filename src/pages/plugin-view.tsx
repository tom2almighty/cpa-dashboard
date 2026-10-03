import { useQuery } from "@tanstack/react-query";
import { Puzzle, Settings2 } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { fetchPlugins, PLUGINS_KEY, resolvePluginMenuUrl } from "@/lib/plugins";

export function PluginViewPage() {
  const { pluginId = "" } = useParams<{ pluginId: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();

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
      <div className="flex size-full min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!plugin || plugin.effective_enabled === false || !activeMenu) {
    return (
      <div className="flex size-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <Puzzle className="size-10 text-muted-foreground/60" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("plugins.view_not_found")}</p>
          <p className="text-xs text-muted-foreground">{t("plugins.view_not_found_hint")}</p>
        </div>
        <Button variant="outline" size="sm" render={<Link to="/plugins" />}>
          <Settings2 className="size-3.5" />
          {t("nav.plugins")}
        </Button>
      </div>
    );
  }

  const title = activeMenu.menu || plugin.metadata?.name || plugin.id;

  return (
    <div className="size-full">
      <iframe
        src={resolvedUrl}
        title={title}
        className="size-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      />
    </div>
  );
}
