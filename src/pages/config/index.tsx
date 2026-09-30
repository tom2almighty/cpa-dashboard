import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import { PayloadRules } from "./payload-rules";
import { ConfigSettingsProvider, GROUPS, SettingsCommon, SettingsGroup, useConfigSettings } from "./settings";
import { YamlEditor } from "./yaml-editor";

function ConfigHeaderActions() {
  const { t } = useI18n();
  const { dirtyCount, resetPatch, saveAll, isSaving } = useConfigSettings();
  if (dirtyCount === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="px-2 py-0.5 text-xs font-normal">
        {dirtyCount} {t("config.pending_save")}
      </Badge>
      <Button variant="outline" size="sm" onClick={resetPatch} disabled={isSaving} className="h-8 text-xs">
        <RotateCcw className="size-3.5" />
        {t("config.discard")}
      </Button>
      <Button size="sm" onClick={saveAll} disabled={isSaving} className="h-8 text-xs">
        {isSaving ? <Spinner className="size-3.5" /> : <Save className="size-3.5" />}
        {t("config.save_changes")}
      </Button>
    </div>
  );
}

function ConfigPageInner() {
  const { t } = useI18n();
  const [tab, setTab] = useState("common");

  return (
    <>
      <PageHeader title={t("config.title")} description={t("config.desc")} actions={<ConfigHeaderActions />} />

      <Tabs value={tab} onValueChange={(v) => v && setTab(v)}>
        <div className="mb-6 -mx-4 px-4 overflow-x-auto no-scrollbar">
          <TabsList className="h-9 gap-1">
            <TabsTrigger value="common" className="px-2.5 py-1 text-xs sm:text-sm">
              {t("config.tabs.common")}
            </TabsTrigger>
            {GROUPS.map((g) => (
              <TabsTrigger key={g.id} value={g.id} className="px-2.5 py-1 text-xs sm:text-sm">
                {t(`config.tabs.${g.id}`)}
              </TabsTrigger>
            ))}
            <div className="h-4 w-px bg-border my-auto mx-1 shrink-0" aria-hidden />
            <TabsTrigger value="payload" className="px-2.5 py-1 text-xs sm:text-sm">
              {t("config.tab_payload_rules")}
            </TabsTrigger>
            <TabsTrigger value="yaml" className="px-2.5 py-1 text-xs sm:text-sm">
              {t("config.tab_yaml_editor")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="common">
          <SettingsCommon />
        </TabsContent>

        {GROUPS.map((g) => (
          <TabsContent key={g.id} value={g.id}>
            <SettingsGroup groupId={g.id} />
          </TabsContent>
        ))}

        <TabsContent value="payload">
          <PayloadRules onGoYaml={() => setTab("yaml")} />
        </TabsContent>

        <TabsContent value="yaml">
          <YamlEditor />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function ConfigPage() {
  return (
    <ConfigSettingsProvider>
      <ConfigPageInner />
    </ConfigSettingsProvider>
  );
}
