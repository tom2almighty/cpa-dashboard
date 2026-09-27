import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayloadRules } from "./payload-rules";
import { ConfigYamlProvider, GROUPS, SettingsGroup, useConfigYaml } from "./settings";
import { YamlEditor } from "./yaml-editor";

function ConfigHeaderActions() {
  const { dirtyCount, resetPatch, saveAll, isSaving } = useConfigYaml();
  if (dirtyCount === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="px-2 py-0.5 text-xs font-normal">
        {dirtyCount} 项待保存
      </Badge>
      <Button variant="outline" size="sm" onClick={resetPatch} disabled={isSaving} className="h-8 text-xs">
        <RotateCcw className="size-3.5" />
        撤销修改
      </Button>
      <Button
        size="sm"
        onClick={() => {
          void saveAll();
        }}
        disabled={isSaving}
        className="h-8 text-xs"
      >
        {isSaving ? <Spinner className="size-3.5" /> : <Save className="size-3.5" />}
        保存配置
      </Button>
    </div>
  );
}

function ConfigPageInner() {
  const [tab, setTab] = useState(GROUPS[0].id);

  return (
    <>
      <PageHeader
        title="配置"
        description="统一基于 config.yaml 原生配置读写，修改原子写入并由 CPA 自动重载生效。"
        actions={<ConfigHeaderActions />}
      />
      <Tabs value={tab} onValueChange={(v) => v && setTab(v)}>
        <TabsList variant="line" className="mb-6 flex-wrap">
          {GROUPS.map((g) => (
            <TabsTrigger key={g.id} value={g.id}>
              {g.title}
            </TabsTrigger>
          ))}
          <TabsTrigger value="payload">Payload 规则</TabsTrigger>
          <TabsTrigger value="yaml">源文件</TabsTrigger>
        </TabsList>

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
    <ConfigYamlProvider>
      <ConfigPageInner />
    </ConfigYamlProvider>
  );
}
