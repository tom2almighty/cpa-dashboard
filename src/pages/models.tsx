import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import { Aliases } from "./models/aliases";
import { AvailableModels } from "./models/available";
import { Catalog } from "./models/catalog";
import { Excluded } from "./models/excluded";

export function ModelsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("models.title")} description={t("models.desc")} />
      <Tabs defaultValue="available">
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="available">{t("models.tab_available")}</TabsTrigger>
          <TabsTrigger value="alias">{t("models.tab_alias")}</TabsTrigger>
          <TabsTrigger value="excluded">{t("models.tab_excluded")}</TabsTrigger>
          <TabsTrigger value="catalog">{t("models.tab_catalog")}</TabsTrigger>
        </TabsList>
        <TabsContent value="available">
          <AvailableModels />
        </TabsContent>
        <TabsContent value="alias">
          <Aliases />
        </TabsContent>
        <TabsContent value="excluded">
          <Excluded />
        </TabsContent>
        <TabsContent value="catalog">
          <Catalog />
        </TabsContent>
      </Tabs>
    </>
  );
}
