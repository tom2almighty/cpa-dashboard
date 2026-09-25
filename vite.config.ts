import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => {
  const lite = mode === "lite";
  // 完整版开发时代理到本项目后端,精简版直接代理到 CPA
  const target = lite
    ? (process.env.CPA_URL ?? "http://localhost:8317")
    : (process.env.BACKEND_URL ?? "http://localhost:8318");

  return {
    plugins: [react(), tailwindcss(), lite && viteSingleFile()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: lite ? { outDir: "dist-lite" } : {},
    server: {
      proxy: {
        "/api": target,
        "/v0": target,
        "/v1": target,
      },
    },
  };
});
