import type { ReactNode } from "react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";

export type EditorMode = "visual" | "text";

/**
 * 可视化 / 文本 双模式切换。全站「结构化编辑 + 文本编辑」的地方共用这套文案与样式，
 * 需要自己持有行状态（如带 id 的行列表）的编辑器只借用它，不强制套 DualModeField。
 */
export function ModeTabs({
  mode,
  onChange,
  visualDisabled,
}: {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
  visualDisabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Tabs value={mode} onValueChange={(value) => value && onChange(value as EditorMode)}>
      <TabsList className="h-7 p-0.5">
        <TabsTrigger value="visual" className="px-2 text-xs" disabled={visualDisabled}>
          {t("common.visual_mode")}
        </TabsTrigger>
        <TabsTrigger value="text" className="px-2 text-xs">
          {t("common.text_mode")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/**
 * 双模式字段外壳：可视化与文本读写同一份字符串。
 * parse 返回 null 表示文本无法结构化，此时锁定在文本模式并给出提示。
 * render 必须是纯渲染（内部需要 hooks 时请拆成组件），write 会把结构化数据写回文本。
 */
export function DualModeField<T>({
  value,
  onChange,
  parse,
  format,
  render,
  invalidHint,
  textareaId,
  ariaLabelledBy,
  placeholder,
  textClassName = "min-h-32 font-mono text-xs",
}: {
  value: string;
  onChange: (text: string) => void;
  parse: (text: string) => T | null;
  format: (data: T) => string;
  render: (data: T, write: (next: T) => void) => ReactNode;
  invalidHint: string;
  textareaId?: string;
  ariaLabelledBy?: string;
  placeholder?: string;
  textClassName?: string;
}) {
  const [mode, setMode] = useState<EditorMode>("visual");
  const data = parse(value);
  const write = (next: T) => onChange(format(next));

  return (
    <div className="grid gap-3">
      <ModeTabs
        mode={mode === "visual" && data !== null ? "visual" : "text"}
        onChange={setMode}
        visualDisabled={data === null}
      />
      {mode === "visual" && data !== null ? (
        render(data, write)
      ) : (
        <div className="grid gap-1.5">
          <Textarea
            id={textareaId}
            aria-labelledby={ariaLabelledBy}
            aria-invalid={data === null}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={textClassName}
          />
          {data === null && <p className="text-xs text-destructive">{invalidHint}</p>}
        </div>
      )}
    </div>
  );
}
