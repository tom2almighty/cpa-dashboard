import { toast } from "sonner";
import i18n from "@/i18n";
import { errorText } from "./api";

const DETAIL_DURATION = 10_000;
const SHORT_DURATION = 6_000;

/**
 * 统一错误 toast:标题保持一行,详情放进限高滚动区域,并提供复制完整内容的操作。
 * 长错误(批量失败、YAML/配置校验信息)不再把 toast 撑出屏幕,也不会被静默截断。
 */
export function showErrorToast(title: string, detail?: string) {
  const full = detail ? `${title}\n\n${detail}` : title;
  toast.error(title, {
    description: detail ? (
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs">{detail}</div>
    ) : undefined,
    action: {
      label: i18n.t("common.copy"),
      onClick: () => {
        void navigator.clipboard.writeText(full).catch(() => {});
      },
    },
    duration: detail ? DETAIL_DURATION : SHORT_DURATION,
  });
}

export function showError(error: unknown, title?: string) {
  const detail = errorText(error);
  showErrorToast(title ?? detail, title ? detail : undefined);
}
