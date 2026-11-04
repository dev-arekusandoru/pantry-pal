import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      // The Hono server (`pnpm dev` at the repo root) listens on 8787.
      // Override with PANTRYPAL_API_URL to point at another instance.
      "/api": process.env.PANTRYPAL_API_URL ?? "http://127.0.0.1:8787",
      "/health": process.env.PANTRYPAL_API_URL ?? "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
