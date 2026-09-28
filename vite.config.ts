import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function emitManagementHtml(): Plugin {
  return {
    name: "emit-management-html",
    closeBundle() {
      const distDir = path.resolve(import.meta.dirname, "dist");
      const indexPath = path.join(distDir, "index.html");
      const managementPath = path.join(distDir, "management.html");
      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, managementPath);
      }
    },
  };
}

export default defineConfig(() => {
  const target = process.env.CPA_URL ?? "http://localhost:8317";
  const appVersion = process.env.APP_VERSION ?? "";

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [react(), tailwindcss(), viteSingleFile(), emitManagementHtml()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
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
