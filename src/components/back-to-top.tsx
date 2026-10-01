import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";

/**
 * 窗口滚动超过 threshold 后出现在右下角的返回顶部按钮。
 * 挂在 Layout 上由所有页面共用；滚动发生在页面内部容器时（如日志页）不适用。
 */
export function BackToTop({ threshold = 300 }: { threshold?: number }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    // 首次挂载时同步一次,覆盖带着滚动位置进入页面的情况
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={t("common.back_to_top")}
      title={t("common.back_to_top")}
      className="fixed bottom-6 right-6 z-40 rounded-full bg-background/80 shadow-md backdrop-blur transition-all"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <ArrowUp className="size-4" />
    </Button>
  );
}
