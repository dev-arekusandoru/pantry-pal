import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb, Store } from "./db.js";
import { smtpMailer } from "./mail.js";

const config = loadConfig();
const store = new Store(openDb(process.env.WAITLIST_DB_PATH ?? "data/waitlist.db"));
const { app, drain } = createApp({
  config,
  store,
  mailer: config.smtp ? smtpMailer(config.smtp) : undefined,
});

const port = Number(process.env.PORT ?? 8790);
const hostname = process.env.HOST ?? "127.0.0.1";
const server = serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(
    `[waitlist] listening on ${hostname}:${port} for sites: ${Object.keys(config.sites).join(", ")}` +
      (config.smtp ? "" : " (no SMTP configured: welcome emails are off)"),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void drain().finally(() => process.exit(0));
  });
}
