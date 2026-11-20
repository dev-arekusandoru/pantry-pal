import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface Subscriber {
  id: number;
  site: string;
  email: string;
  createdAt: string;
  welcomeSentAt: string | null;
  invitedAt: string | null;
  unsubscribedAt: string | null;
}

interface Row {
  id: number;
  site: string;
  email: string;
  created_at: string;
  welcome_sent_at: string | null;
  invited_at: string | null;
  unsubscribed_at: string | null;
}

const toSubscriber = (r: Row): Subscriber => ({
  id: r.id,
  site: r.site,
  email: r.email,
  createdAt: r.created_at,
  welcomeSentAt: r.welcome_sent_at,
  invitedAt: r.invited_at,
  unsubscribedAt: r.unsubscribed_at,
});

export function openDb(file: string): Database.Database {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("busy_timeout = 5000");
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriber (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      welcome_sent_at TEXT,
      invited_at TEXT,
      unsubscribed_at TEXT,
      UNIQUE (site, email)
    );
  `);
  return db;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercase and trim. Returns null when the address is not plausible. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export class Store {
  constructor(private readonly db: Database.Database) {}

  /** Add an address, or reactivate one that unsubscribed. */
  add(site: string, email: string, now: Date): Subscriber {
    this.db
      .prepare(
        `INSERT INTO subscriber (site, email, created_at) VALUES (?, ?, ?)
         ON CONFLICT (site, email) DO UPDATE SET unsubscribed_at = NULL`,
      )
      .run(site, email, now.toISOString());
    return toSubscriber(
      this.db.prepare("SELECT * FROM subscriber WHERE site = ? AND email = ?").get(site, email) as Row,
    );
  }

  markWelcomeSent(id: number, now: Date): void {
    this.db.prepare("UPDATE subscriber SET welcome_sent_at = ? WHERE id = ?").run(now.toISOString(), id);
  }

  get(id: number): Subscriber | undefined {
    const row = this.db.prepare("SELECT * FROM subscriber WHERE id = ?").get(id) as Row | undefined;
    return row && toSubscriber(row);
  }

  unsubscribe(id: number, now: Date): boolean {
    return (
      this.db
        .prepare("UPDATE subscriber SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE id = ?")
        .run(now.toISOString(), id).changes > 0
    );
  }

  /** Active subscribers (not unsubscribed), oldest first. */
  list(options: { site?: string; pending?: boolean; limit?: number } = {}): Subscriber[] {
    const where = ["unsubscribed_at IS NULL"];
    const args: (string | number)[] = [];
    if (options.site !== undefined) {
      where.push("site = ?");
      args.push(options.site);
    }
    if (options.pending) where.push("invited_at IS NULL");
    args.push(options.limit ?? -1);
    const rows = this.db
      .prepare(`SELECT * FROM subscriber WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`)
      .all(...args) as Row[];
    return rows.map(toSubscriber);
  }

  markInvited(ids: number[], now: Date): void {
    const stmt = this.db.prepare("UPDATE subscriber SET invited_at = COALESCE(invited_at, ?) WHERE id = ?");
    this.db.transaction(() => {
      for (const id of ids) stmt.run(now.toISOString(), id);
    })();
  }

  remove(site: string, email: string): boolean {
    return this.db.prepare("DELETE FROM subscriber WHERE site = ? AND email = ?").run(site, email).changes > 0;
  }

  find(site: string, email: string): Subscriber | undefined {
    const row = this.db.prepare("SELECT * FROM subscriber WHERE site = ? AND email = ?").get(site, email) as
      | Row
      | undefined;
    return row && toSubscriber(row);
  }
}
