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

// 简明标签名称，避免完整长标题导致横向折行与拥挤
const TAB_TITLES: Record<string, string> = {
  server: "服务器",
  management: "管理",
  routing: "路由",
  requests: "请求",
  oauth: "OAuth",
  multimedia: "多媒体",
  observability: "可观测",
  plugins: "插件",
};

function ConfigPageInner() {
  const [tab, setTab] = useState(GROUPS[0].id);

  return (
    <>
      <PageHeader
        title="系统配置"
        description="统一基于 config.yaml 原生配置读写，修改原子写入并由 CPA 自动重载生效。"
        actions={<ConfigHeaderActions />}
      />

      <Tabs value={tab} onValueChange={(v) => v && setTab(v)}>
        <div className="mb-6 -mx-4 px-4 overflow-x-auto no-scrollbar">
          <TabsList className="h-9 gap-1">
            {GROUPS.map((g) => (
              <TabsTrigger key={g.id} value={g.id} className="px-2.5 py-1 text-xs sm:text-sm">
                {TAB_TITLES[g.id] || g.title}
              </TabsTrigger>
            ))}
            <div className="h-4 w-px bg-border my-auto mx-1 shrink-0" aria-hidden />
            <TabsTrigger value="payload" className="px-2.5 py-1 text-xs sm:text-sm">
              Payload 规则
            </TabsTrigger>
            <TabsTrigger value="yaml" className="px-2.5 py-1 text-xs sm:text-sm">
              YAML 源码
            </TabsTrigger>
          </TabsList>
        </div>

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
