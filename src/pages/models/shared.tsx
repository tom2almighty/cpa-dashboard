import { useQuery } from "@tanstack/react-query";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useI18n } from "@/i18n/context";
import { api } from "@/lib/api";

// 静态模型目录支持的渠道(routing/model-definitions/:channel),别名 kimi.ai / x-ai 等由 CPA 内部归一
// 排除模型列表最多直接展示的条目数,其余折叠为 +N 悬浮查看
export const EXCLUDED_VISIBLE = 8;

export const CHANNELS = [
  "codex",
  "claude",
  "gemini",
  "gemini-interactions",
  "antigravity",
  "vertex",
  "aistudio",
  "kimi",
  "xai",
  "devin",
  "meta",
];
// OAuth 别名/排除的渠道:与 CPA 的 OAuthModelAliasChannel 一致,gemini 系列只走 API Key,
// kimi-ai 凭据的渠道是 kimi-ai 而不是 kimi;插件 OAuth 提供商用其 provider key,故允许自由输入
export const ALIAS_CHANNELS = [
  "claude",
  "codex",
  "antigravity",
  "vertex",
  "aistudio",
  "kimi",
  "kimi-ai",
  "xai",
  "meta",
  "devin",
];
export type OAuthConfig = { "model-alias"?: Record<string, Alias[]>; "excluded-models"?: Record<string, string[]> };
export const oauthOf = (c: Record<string, unknown>) => (c.oauth ?? {}) as OAuthConfig;
export type Alias = { name: string; alias: string; fork?: boolean; "display-name"?: string; "force-mapping"?: boolean };
export type CatalogModel = { id: string; display_name?: string; owned_by?: string; context_length?: number };

export function useCatalog(channel: string) {
  return useQuery({
    queryKey: ["cpa", "model-definitions", channel],
    queryFn: () =>
      api<{ models?: CatalogModel[] }>(`/v8/management/routing/model-definitions/${encodeURIComponent(channel)}`),
    select: (res) => res.models ?? [],
    enabled: Boolean(channel),
    retry: false,
    staleTime: 10 * 60_000,
  });
}

/**
 * 可输入的单选下拉。值不在候选里时按输入内容生效 —— 渠道名和上游模型名都需要
 * 「既能选、也能自己填」的语义。用站内的 Combobox 而不是原生 <datalist>，
 * 样式与提供商页的模型选择保持一致。
 */
export function SuggestInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <Combobox
      autoHighlight
      items={options}
      // 默认过滤不去空格，粘贴的模型名常带尾随空格
      filter={(item: string, query: string) => item.toLowerCase().includes(query.trim().toLowerCase())}
      value={value || null}
      onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
      inputValue={value}
      onInputValueChange={(next) => onChange(next)}
    >
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="w-full"
        onKeyDown={(e) => {
          // 没有高亮项时回车会提交外层表单
          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
        }}
      />
      <ComboboxContent>
        <ComboboxEmpty>{t("models.combobox_empty")}</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item} className="font-mono text-xs">
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
