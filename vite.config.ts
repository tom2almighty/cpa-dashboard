import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(() => {
  const target = process.env.CPA_URL ?? "http://localhost:8317";

  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
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
