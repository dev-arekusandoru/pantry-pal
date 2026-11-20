import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// `site` drives canonical URLs and the sitemap.
export default defineConfig({
  site: "https://rakumi.app",
  integrations: [sitemap()],
});
