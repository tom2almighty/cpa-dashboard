import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

async function resolveAppVersion(): Promise<string> {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const res = await fetch("https://api.github.com/repos/tom2almighty/cpa-dashboard/releases/latest", {
      headers: { "User-Agent": "cpa-dashboard" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string };
      if (data.tag_name) return data.tag_name;
    }
  } catch {}
  return "";
}

export default defineConfig(async () => {
  const target = process.env.CPA_URL ?? "http://localhost:8317";
  const appVersion = await resolveAppVersion();
  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    // 入口即 CPA 拉取的资产名,直接产出 dist/management.html
    build: {
      rolldownOptions: {
        input: path.resolve(import.meta.dirname, "management.html"),
      },
    },
    server: {
      proxy: {
        "/v0": target,
        "/v1": target,
      },
    },
  };
});
