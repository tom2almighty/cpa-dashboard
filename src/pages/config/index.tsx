import { ChevronLeft, ChevronRight, RotateCcw, Save, Search } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useI18n } from "@/i18n/context";
import { PayloadRules } from "./payload-rules";
import {
  type ConfigGroup,
  type ConfigSection,
  ConfigSettingsProvider,
  GROUPS,
  type Setting,
  SettingField,
  SettingsGroup,
  useConfigSettings,
} from "./settings";
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

type SearchMatch = { group: ConfigGroup; section: ConfigSection; items: Setting[] };

function ConfigSearchResults({ matches }: { matches: SearchMatch[] }) {
  const { t } = useI18n();
  if (matches.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t("config.search_empty")}</p>;
  }
  return (
    <div className="grid gap-8">
      {matches.map(({ group, section, items }) => (
        <section key={`${group.id}-${section.id}`}>
          <h2 className="mb-1 text-sm font-medium">
            {t(`config.groups.${group.id}` as never)}
            <span className="mx-1.5 text-muted-foreground">/</span>
            <span className="text-muted-foreground">{t(`config.sections.${group.id}.${section.id}` as never)}</span>
          </h2>
          <div className="divide-y">
            {items.map((setting) => (
              <SettingField key={setting.endpoint} setting={setting} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConfigPageInner() {
  const { t } = useI18n();
  const { dirtyCount, patch } = useConfigSettings();
  const [tab, setTab] = useState(GROUPS[0].id);
  const [query, setQuery] = useState("");
  const [onlyDirty, setOnlyDirty] = useState(false);
  const [yamlDirty, setYamlDirty] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const blocker = useUnsavedChanges(dirtyCount > 0 || yamlDirty);
  const searching = deferredQuery.trim() !== "" || onlyDirty;
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });

  const updateTabOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setTabOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    updateTabOverflow();
    const observer = new ResizeObserver(updateTabOverflow);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", updateTabOverflow, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateTabOverflow);
    };
  }, [updateTabOverflow]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tab 变化后需要把新激活的标签滚进可视区
  useEffect(() => {
    updateTabOverflow();
    const active = tabsRef.current?.querySelector<HTMLElement>("[data-active]");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab, updateTabOverflow]);

  const scrollTabs = (direction: -1 | 1) => {
    tabsRef.current?.scrollBy({ left: direction * 240, behavior: "smooth" });
  };

  const matches = useMemo<SearchMatch[]>(() => {
    if (!searching) return [];
    const keyword = deferredQuery.trim().toLowerCase();
    const out: SearchMatch[] = [];
    for (const group of GROUPS) {
      for (const section of group.sections) {
        const items = section.items.filter((setting) => {
          if (onlyDirty && !Object.hasOwn(patch, setting.endpoint)) return false;
          if (!keyword) return true;
          const label = t(`config.fields.${setting.endpoint}.label` as never);
          const hint = t(`config.fields.${setting.endpoint}.hint` as never);
          return [setting.endpoint, label, hint].some((value) => String(value).toLowerCase().includes(keyword));
        });
        if (items.length > 0) out.push({ group, section, items });
      }
    }
    return out;
  }, [deferredQuery, onlyDirty, patch, searching, t]);

  return (
    <>
      <PageHeader title={t("config.title")} description={t("config.desc")} />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (!value) return;
          setTab(value);
          setQuery("");
          setOnlyDirty(false);
        }}
      >
        {/* 配置项多,tab 栏和保存操作一起吸顶;移动端让开顶部 48px 的 sticky 头部 */}
        <div className="sticky top-12 z-10 -mx-4 mb-4 bg-background px-4 py-2 md:top-0 md:-mx-8 md:px-8">
          <div className="flex flex-col gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                className="hidden shrink-0 md:inline-flex"
                disabled={!tabOverflow.left}
                title={t("config.scroll_tabs_left")}
                aria-label={t("config.scroll_tabs_left")}
                onClick={() => scrollTabs(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div ref={tabsRef} className="min-w-0 flex-1 overflow-x-auto scroll-smooth no-scrollbar">
                <TabsList className="h-9 w-max gap-1">
                  {GROUPS.map((g) => (
                    <TabsTrigger key={g.id} value={g.id} className="shrink-0 px-2.5 py-1 text-xs sm:text-sm">
                      {t(`config.tabs.${g.id}` as never)}
                    </TabsTrigger>
                  ))}
                  <div className="h-4 w-px bg-border my-auto mx-1 shrink-0" aria-hidden />
                  <TabsTrigger value="payload" className="shrink-0 px-2.5 py-1 text-xs sm:text-sm">
                    {t("config.tab_payload_rules")}
                  </TabsTrigger>
                  <TabsTrigger value="yaml" className="shrink-0 px-2.5 py-1 text-xs sm:text-sm">
                    {t("config.tab_yaml_editor")}
                  </TabsTrigger>
                </TabsList>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="hidden shrink-0 md:inline-flex"
                disabled={!tabOverflow.right}
                title={t("config.scroll_tabs_right")}
                aria-label={t("config.scroll_tabs_right")}
                onClick={() => scrollTabs(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("config.search_placeholder")}
                  aria-label={t("config.search_placeholder")}
                  className="h-8 w-40 pl-8 text-xs sm:w-52"
                />
              </div>
              <Button
                variant={onlyDirty ? "secondary" : "outline"}
                size="sm"
                className="h-8 text-xs"
                aria-pressed={onlyDirty}
                onClick={() => setOnlyDirty((value) => !value)}
              >
                {t("config.only_modified")}
                {dirtyCount > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 text-xs tabular-nums">
                    {dirtyCount}
                  </Badge>
                )}
              </Button>
              <ConfigHeaderActions />
            </div>
          </div>
        </div>

        {searching && <ConfigSearchResults matches={matches} />}

        {GROUPS.map((g) => (
          <TabsContent key={g.id} value={g.id} className={searching ? "hidden" : undefined}>
            <SettingsGroup groupId={g.id} />
          </TabsContent>
        ))}

        <TabsContent value="payload" className={searching ? "hidden" : undefined}>
          <PayloadRules onGoYaml={() => setTab("yaml")} />
        </TabsContent>

        <TabsContent value="yaml" keepMounted className={searching ? "hidden" : undefined}>
          <YamlEditor active={tab === "yaml"} onDirtyChange={setYamlDirty} />
        </TabsContent>
      </Tabs>

      <UnsavedChangesDialog blocker={blocker} />
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
