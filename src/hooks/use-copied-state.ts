import { useEffect, useRef, useState } from "react";

/** 复制成功标记:超时自动清除,组件卸载时清理定时器 */
export function useCopiedState(resetAfter = 2000) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const mark = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(value);
    timer.current = setTimeout(() => setCopied(null), resetAfter);
  };

  return { copied, mark };
}
