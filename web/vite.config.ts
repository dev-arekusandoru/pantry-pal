import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain `{ target }` keeps the browser's `Host` (Vite's string shorthand sets
// changeOrigin), so the server's `Origin` == `Host` check passes.
const proxyEntry = { target: process.env.PANTRYPAL_API_URL ?? "http://127.0.0.1:4787" };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      // The Hono server (`pnpm dev` at the repo root) listens on 4787.
      // Override with PANTRYPAL_API_URL to point at another instance.
      "/api": proxyEntry,
      "/health": proxyEntry,
      "/auth": proxyEntry,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // OpenMoji SVGs are shared, cacheable files; keep them out of the JS bundle
    // instead of base64-inlining everything under Vite's default 4 kB limit.
    assetsInlineLimit: 0,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
