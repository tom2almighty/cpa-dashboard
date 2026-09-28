import { useI18n } from "@/i18n/context";
import type { RecentBucket } from "@/lib/types";

const BAR = 4;
const GAP = 1.5;
const HEIGHT = 20;

// CPA 的 recent_requests:最近 20 个 10 分钟桶,成功在下、失败叠在上
export function RequestSparkline({ buckets, label }: { buckets: RecentBucket[]; label: string }) {
  const { t } = useI18n();
  if (buckets.length === 0) return <span className="text-muted-foreground">—</span>;
  const max = Math.max(1, ...buckets.map((b) => b.success + b.failed));
  const success = buckets.reduce((sum, b) => sum + b.success, 0);
  const failed = buckets.reduce((sum, b) => sum + b.failed, 0);
  return (
    <svg
      role="img"
      aria-label={t("sparkline.aria", { label, minutes: buckets.length * 10, success, failed })}
      width={buckets.length * (BAR + GAP) - GAP}
      height={HEIGHT}
      className="block overflow-visible"
    >
      {buckets.map((b, i) => {
        const x = i * (BAR + GAP);
        const total = b.success + b.failed;
        if (total === 0) {
          return <rect key={b.time} x={x} y={HEIGHT - 1} width={BAR} height={1} className="fill-border" />;
        }
        const failH = (b.failed / max) * HEIGHT;
        const okH = (b.success / max) * HEIGHT;
        return (
          <g key={b.time}>
            <title>{t("sparkline.bucket", { time: b.time, success: b.success, failed: b.failed })}</title>
            {okH > 0 && <rect x={x} y={HEIGHT - okH} width={BAR} height={okH} rx={1} className="fill-primary" />}
            {failH > 0 && (
              <rect x={x} y={HEIGHT - okH - failH} width={BAR} height={failH} rx={1} className="fill-destructive" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
