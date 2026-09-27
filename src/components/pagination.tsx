import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// 列表过长时分页渲染;页码越界时收回到最后一页
export function paginate<T>(items: T[], page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pageCount);
  return { pageItems: items.slice((current - 1) * size, current * size), current, pageCount };
}

export function Pagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="分页" className="mt-4 flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>共 {total} 项</span>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="首页"
          title="首页"
          disabled={page <= 1}
          onClick={() => onChange(1)}
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="上一页"
          title="上一页"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular-nums px-1 text-xs sm:text-sm">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="下一页"
          title="下一页"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="末页"
          title="末页"
          disabled={page >= pageCount}
          onClick={() => onChange(pageCount)}
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
