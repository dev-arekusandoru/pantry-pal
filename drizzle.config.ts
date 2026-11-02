import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.PANTRYPAL_DB_PATH ?? "./data/pantrypal.db",
  },
  strict: true,
  verbose: true,
});
