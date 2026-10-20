import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import { Installed } from "./plugins/installed";
import { Store } from "./plugins/store";

export function PluginsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("plugins.title")} description={t("plugins.desc")} />
      <Tabs defaultValue="installed">
        <TabsList className="mb-6">
          <TabsTrigger value="installed">{t("plugins.tab_installed")}</TabsTrigger>
          <TabsTrigger value="store">{t("plugins.tab_store")}</TabsTrigger>
        </TabsList>
        <TabsContent value="installed">
          <Installed />
        </TabsContent>
        <TabsContent value="store">
          <Store />
        </TabsContent>
      </Tabs>
    </>
  );
}
