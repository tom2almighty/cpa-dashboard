import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(join(config.dataDir, "dashboard.sqlite"), { create: true, strict: true });

db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA synchronous = NORMAL;");

db.run(`
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    request_id TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    alias TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    auth_index TEXT NOT NULL DEFAULT '',
    auth_type TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL DEFAULT '',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    failed INTEGER NOT NULL DEFAULT 0
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events (ts)");

// 价格单位:美元 / token,来自 LiteLLM
db.run(`
  CREATE TABLE IF NOT EXISTS model_prices (
    model TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT '',
    input REAL NOT NULL DEFAULT 0,
    output REAL NOT NULL DEFAULT 0,
    cache_read REAL,
    cache_creation REAL
  )
`);

db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

export function getMeta(key: string): string | null {
  const row = db.query<{ value: string }, { key: string }>("SELECT value FROM meta WHERE key = $key").get({ key });
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  db.query(
    "INSERT INTO meta (key, value) VALUES ($key, $value) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run({ key, value });
}
