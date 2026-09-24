function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`环境变量 ${name} 必须是正数`);
  return value;
}

export const config = {
  port: positiveNumber("PORT", 8318),
  cpaUrl: required("CPA_URL").replace(/\/+$/, ""),
  managementKey: required("CPA_MANAGEMENT_KEY"),
  dataDir: process.env.DATA_DIR?.trim() || "./data",
  staticDir: process.env.STATIC_DIR?.trim() || "./dist",
  pollIntervalMs: positiveNumber("POLL_INTERVAL_MS", 3000),
  priceSyncHours: positiveNumber("PRICE_SYNC_HOURS", 24),
  pricesUrl:
    process.env.LITELLM_PRICES_URL?.trim() ||
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
};
