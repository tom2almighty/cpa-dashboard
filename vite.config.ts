import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(() => {
  const target = process.env.CPA_URL ?? "http://localhost:8317";
  const appVersion = process.env.APP_VERSION ?? "";

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
        "/v8": target,
        "/v1": target,
        "/v0": target,
      },
    },
  };
});
