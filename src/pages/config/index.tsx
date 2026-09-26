import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayloadRules } from "./payload-rules";
import { GROUPS, SettingsGroup } from "./settings";
import { YamlEditor } from "./yaml-editor";

export function ConfigPage() {
  const [tab, setTab] = useState(GROUPS[0].id);
  return (
    <>
      <PageHeader title="配置" description="修改会写回 CPA 的 config.yaml 并立即生效。" />
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
