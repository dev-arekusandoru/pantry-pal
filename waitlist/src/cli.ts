import { parseArgs } from "node:util";
import { normalizeEmail, openDb, Store, type Subscriber } from "./db.js";

const USAGE = `Usage: waitlist <command> [options]   (database: WAITLIST_DB_PATH, default data/waitlist.db)

  count   [--site ID]                       Active subscribers and how many are not invited yet
  list    [--site ID] [--pending]           Table of active subscribers
  export  [--site ID] [--pending]           CSV on stdout: site,email,created_at,invited_at
  invite  --site ID --next N | EMAIL...     Mark people as invited and print their addresses
  remove  --site ID EMAIL                   Delete one address
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: "string" },
    pending: { type: "boolean", default: false },
    next: { type: "string" },
  },
});
const [command, ...rest] = positionals;
const store = new Store(openDb(process.env.WAITLIST_DB_PATH ?? "data/waitlist.db"));
const site = values.site;
const filter = { ...(site !== undefined && { site }), pending: values.pending };

const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const line = (s: Subscriber) => [s.site, s.email, s.createdAt, s.invitedAt ?? ""].map(csv).join(",");

switch (command) {
  case "count": {
    const all = store.list(filter);
    const pending = all.filter((s) => s.invitedAt === null).length;
    console.log(`${all.length} active, ${pending} not invited yet`);
    break;
  }
  case "list":
    for (const s of store.list(filter)) {
      console.log(`${s.createdAt.slice(0, 10)}  ${s.site.padEnd(16)} ${s.email}${s.invitedAt ? "  (invited)" : ""}`);
    }
    break;
  case "export":
    console.log("site,email,created_at,invited_at");
    for (const s of store.list(filter)) console.log(line(s));
    break;
  case "invite": {
    if (site === undefined) throw new Error("--site is required");
    let chosen: Subscriber[];
    if (values.next !== undefined) {
      const n = Number(values.next);
      if (!Number.isInteger(n) || n < 1) throw new Error("--next must be a positive whole number");
      chosen = store.list({ site, pending: true, limit: n });
    } else {
      if (rest.length === 0) throw new Error("give --next N or one or more addresses");
      chosen = rest.map((raw) => {
        const email = normalizeEmail(raw);
        const found = email && store.find(site, email);
        if (!found || found.unsubscribedAt) throw new Error(`${raw} is not an active subscriber of ${site}`);
        return found;
      });
    }
    store.markInvited(chosen.map((s) => s.id), new Date());
    for (const s of chosen) console.log(s.email);
    console.error(`Marked ${chosen.length} as invited. This command sends no email.`);
    break;
  }
  case "remove": {
    const email = normalizeEmail(rest[0]);
    if (site === undefined || email === null) throw new Error("usage: remove --site ID EMAIL");
    console.log(store.remove(site, email) ? "Removed." : "No such address.");
    break;
  }
  default:
    console.log(USAGE);
    process.exitCode = command === undefined ? 0 : 1;
}
