import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runLifecycle } from "../src/billing/lifecycle.js";
import { setExempt } from "../src/billing/state.js";
import { makeCtx } from "../src/context.js";
import { openDb, runMigrations } from "../src/db/client.js";
import { accounts, householdBilling, households, ingredients, subscriptions } from "../src/db/schema.js";
import { readFileSync } from "node:fs";
import { loadSeed } from "../src/seed/load.js";
import { addIngredient } from "./helpers.js";
import { DAY_MS, makeHostedApp, polarSubscription, type HostedTestApp } from "./hosted-helpers.js";

const SEED_JSON = JSON.parse(readFileSync(new URL("../seed/example.json", import.meta.url), "utf8")) as unknown;
const START = new Date("2026-11-01T12:00:00.000Z");
const at = (days: number) => new Date(START.getTime() + days * DAY_MS);

function job(app: HostedTestApp, days: number) {
  app.setNow(at(days));
  return runLifecycle({
    db: app.db,
    billing: app.billing!,
    mailer: app.mailer,
    publicUrl: "https://app.rakumi.test",
    now: app.now,
    log: () => {},
  });
}

function householdExists(app: HostedTestApp, id: string): boolean {
  return app.db.select().from(households).where(eq(households.id, id)).get() !== undefined;
}

async function lockedHousehold() {
  const app = makeHostedApp();
  const { householdId, email } = await app.signup();
  app.mailer.sent.length = 0; // drop the verification mail
  return { app, householdId, email };
}

describe("lock and deletion job", () => {
  it("warns on day 23 and day 29, then deletes on day 30 with everything the household owns", async () => {
    const { app, householdId, email } = await lockedHousehold();
    addIngredient(makeCtx(app.db, householdId, app.now), "Flour");
    expect(app.db.select().from(ingredients).all().length).toBeGreaterThan(0);

    expect((await job(app, 22)).warned).toEqual([]);
    expect(app.mailer.sent).toHaveLength(0);

    const day23 = await job(app, 23);
    expect(day23.warned).toEqual([{ householdId, day: 23 }]);
    expect(app.mailer.sent).toHaveLength(1);
    expect(app.mailer.sent[0]).toMatchObject({ to: email });
    expect(app.mailer.sent[0]?.text).toContain("1 December 2026");
    expect(app.mailer.sent[0]?.html).toContain("1 December 2026");

    // Idempotent: another run on the same day sends nothing new.
    await job(app, 23.5);
    expect(app.mailer.sent).toHaveLength(1);

    const day29 = await job(app, 29);
    expect(day29.warned).toEqual([{ householdId, day: 29 }]);
    expect(app.mailer.sent).toHaveLength(2);
    // Never subscribed: the notice invites them to start the trial.
    expect(app.mailer.sent[1]?.subject).toContain("Last chance");
    expect(app.mailer.sent[1]?.text).toContain("Start my free trial");
    expect(householdExists(app, householdId)).toBe(true);

    expect((await job(app, 29.5)).deleted).toEqual([]);
    expect(app.mailer.sent).toHaveLength(2);

    const day30 = await job(app, 30);
    expect(day30.deleted).toEqual([householdId]);
    expect(householdExists(app, householdId)).toBe(false);
    expect(app.db.select().from(accounts).all()).toHaveLength(0);
    expect(app.db.select().from(ingredients).all()).toHaveLength(0);
    expect(app.db.select().from(householdBilling).all()).toHaveLength(0);

    // Idempotent after deletion too.
    expect(await job(app, 31)).toEqual({ warned: [], deleted: [] });
    expect(app.mailer.sent).toHaveLength(2);
  });

  it("skips exempt households", async () => {
    const { app, householdId } = await lockedHousehold();
    setExempt(app.db, householdId, true, app.now());

    expect(await job(app, 24)).toEqual({ warned: [], deleted: [] });
    expect(await job(app, 40)).toEqual({ warned: [], deleted: [] });
    expect(householdExists(app, householdId)).toBe(true);
    expect(app.mailer.sent).toHaveLength(0);
  });

  it("starts the clock for an existing household when billing is first turned on, and clears it when exempted", async () => {
    const app = makeHostedApp({ billing: false });
    const { householdId } = await app.signup();
    app.mailer.sent.length = 0;
    // Billing is switched on later: same database, billing services now present.
    const later = makeHostedApp();
    expect(app.db.select().from(householdBilling).all()).toHaveLength(0);
    expect(later.billing).not.toBeNull();

    const result = await runLifecycle({
      db: app.db,
      billing: later.billing!,
      mailer: app.mailer,
      publicUrl: "https://app.rakumi.test",
      now: app.now,
      log: () => {},
    });
    expect(result).toEqual({ warned: [], deleted: [] });
    const row = app.db.select().from(householdBilling).where(eq(householdBilling.householdId, householdId)).get();
    expect(row?.lockedAt).toBe(app.now().toISOString());

    setExempt(app.db, householdId, true, app.now());
    await runLifecycle({
      db: app.db,
      billing: later.billing!,
      mailer: app.mailer,
      publicUrl: "https://app.rakumi.test",
      now: app.now,
      log: () => {},
    });
    expect(app.db.select().from(householdBilling).get()).toMatchObject({ exempt: true, lockedAt: null });
  });

  it("restarts the clock when the household locks again after a plan", async () => {
    const { app, householdId } = await lockedHousehold();
    await job(app, 23);
    expect(app.mailer.sent).toHaveLength(1);

    app.setNow(at(24));
    await app.webhook({
      type: "subscription.active",
      data: polarSubscription(householdId, { status: "active", modified_at: at(24).toISOString() }),
    });
    expect(app.db.select().from(householdBilling).get()).toMatchObject({
      lockedAt: null,
      warnedDay23At: null,
      warnedDay29At: null,
    });
    expect((await job(app, 40)).deleted).toEqual([]);

    app.setNow(at(41));
    await app.webhook({
      type: "subscription.revoked",
      data: polarSubscription(householdId, { status: "canceled", modified_at: at(41).toISOString() }),
    });
    expect((await job(app, 63)).warned).toEqual([]); // 22 days after the new lock
    expect((await job(app, 64)).warned).toEqual([{ householdId, day: 23 }]);
  });

  it("does not delete a household that regained access", async () => {
    const { app, householdId } = await lockedHousehold();
    await job(app, 29);
    app.setNow(at(29.5));
    await app.webhook({
      type: "subscription.created",
      data: polarSubscription(householdId, { status: "trialing", modified_at: at(29.5).toISOString() }),
    });
    expect((await job(app, 31)).deleted).toEqual([]);
    expect(householdExists(app, householdId)).toBe(true);
    expect(app.db.select().from(subscriptions).all()).toHaveLength(1);
  });

  it("words the warning as a lapsed plan when the household had a subscription", async () => {
    const { app, householdId } = await lockedHousehold();
    await app.webhook({
      type: "subscription.revoked",
      data: polarSubscription(householdId, { status: "canceled", modified_at: at(0).toISOString() }),
    });
    await job(app, 29);
    expect(app.mailer.sent[0]?.subject).toContain("Last notice");
    expect(app.mailer.sent[0]?.text).not.toContain("free trial");
  });

  it("keeps retrying a warning when mail fails, and does not delete without the final warning", async () => {
    const { app, householdId } = await lockedHousehold();
    app.mailer.failing = true;
    expect((await job(app, 29)).warned).toEqual([]);
    expect((await job(app, 30)).deleted).toEqual([]);
    expect(householdExists(app, householdId)).toBe(true);

    app.mailer.failing = false;
    // The final warning goes out late, with a deletion date at least a day away.
    const late = await job(app, 31);
    expect(late.warned).toEqual([{ householdId, day: 29 }]);
    expect(late.deleted).toEqual([]);
    expect(app.mailer.sent[0]?.text).toContain("3 December 2026");

    expect((await job(app, 31.5)).deleted).toEqual([]);
    expect((await job(app, 32)).deleted).toEqual([householdId]);
  });

  describe("Polar customer", () => {
    const deletes = (app: HostedTestApp) => app.polar.calls.filter((call) => call.method === "DELETE");

    async function lapsedHousehold() {
      const made = await lockedHousehold();
      await made.app.webhook({
        type: "subscription.revoked",
        data: polarSubscription(made.householdId, { status: "canceled", modified_at: at(0).toISOString() }),
      });
      return made;
    }

    it("is deleted and anonymized with the household, by its stored customer id", async () => {
      const { app, householdId } = await lapsedHousehold();
      await job(app, 29);
      expect(deletes(app)).toHaveLength(0);

      expect((await job(app, 30)).deleted).toEqual([householdId]);
      expect(householdExists(app, householdId)).toBe(false);
      expect(deletes(app).map((call) => call.url)).toEqual([
        "https://sandbox-api.polar.sh/v1/customers/cus_1?anonymize=true",
      ]);
    });

    it("is deleted by external id when no customer id was stored", async () => {
      const { app, householdId } = await lockedHousehold();
      await job(app, 29);
      expect((await job(app, 30)).deleted).toEqual([householdId]);
      expect(deletes(app).map((call) => call.url)).toEqual([
        `https://sandbox-api.polar.sh/v1/customers/external/${householdId}?anonymize=true`,
      ]);
    });

    it("counts a customer Polar does not know (404) as deleted", async () => {
      const { app, householdId } = await lapsedHousehold();
      await job(app, 29);
      app.polar.failWith = 404;
      expect((await job(app, 30)).deleted).toEqual([householdId]);
      expect(householdExists(app, householdId)).toBe(false);
    });

    it("keeps the household and retries on the next run when Polar fails", async () => {
      const { app, householdId } = await lapsedHousehold();
      await job(app, 29);
      const logs: string[] = [];
      app.polar.failWith = 500;
      app.setNow(at(30));
      const failed = await runLifecycle({
        db: app.db,
        billing: app.billing!,
        mailer: app.mailer,
        publicUrl: "https://app.rakumi.test",
        now: app.now,
        log: (message) => logs.push(message),
      });
      expect(failed.deleted).toEqual([]);
      expect(householdExists(app, householdId)).toBe(true);
      expect(app.db.select().from(accounts).all()).toHaveLength(1);
      expect(logs.join("\n")).toContain("will retry");

      app.polar.failWith = null;
      expect((await job(app, 30 + 1 / 24)).deleted).toEqual([householdId]);
      expect(householdExists(app, householdId)).toBe(false);
      expect(deletes(app)).toHaveLength(2);
    });
  });

  it("never deletes a household without an account (it cannot be warned)", async () => {
    const { app, householdId } = await lockedHousehold();
    app.db.delete(accounts).where(eq(accounts.householdId, householdId)).run();
    expect(await job(app, 45)).toEqual({ warned: [], deleted: [] });
    expect(householdExists(app, householdId)).toBe(true);
  });

  it("forgets webhook event ids after 30 days", async () => {
    const { app, householdId } = await lockedHousehold();
    await app.webhook({ type: "subscription.created", data: polarSubscription(householdId) });
    expect(app.sqlite.prepare("select count(*) as n from billing_event").get()).toEqual({ n: 1 });
    await job(app, 31);
    expect(app.sqlite.prepare("select count(*) as n from billing_event").get()).toEqual({ n: 0 });
  });
});

describe("household deletion cascades", () => {
  it("every table with a household id deletes with the household", () => {
    const { db, sqlite } = openDb(":memory:");
    runMigrations(db);
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\'")
      .all() as Array<{ name: string }>;

    const missingLink: string[] = [];
    for (const { name } of tables) {
      const columns = sqlite.prepare(`pragma table_info("${name}")`).all() as Array<{ name: string }>;
      const keys = sqlite.prepare(`pragma foreign_key_list("${name}")`).all() as Array<{
        from: string;
        table: string;
        on_delete: string;
      }>;
      // Every table that stores a household id must delete with the household.
      if (columns.some((column) => column.name === "household_id")) {
        const link = keys.find((key) => key.from === "household_id" && key.table === "household");
        if (link?.on_delete !== "CASCADE") missingLink.push(name);
      }
    }
    expect(missingLink).toEqual([]);
  });
});

describe("deleting a fully used household", () => {
  it("removes every row of a household with recipes, plans, cook events, pantry and shopping lists", async () => {
    const { app, householdId } = await lockedHousehold();
    loadSeed(makeCtx(app.db, householdId, app.now), structuredClone(SEED_JSON));

    const counts = () => {
      const sqlite = app.sqlite;
      const tables = sqlite
        .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\'")
        .all() as Array<{ name: string }>;
      return Object.fromEntries(
        tables.map(({ name }) => [name, (sqlite.prepare(`select count(*) as n from "${name}"`).get() as { n: number }).n]),
      );
    };
    const before = counts();
    expect(before.recipe).toBeGreaterThan(0);
    expect(before.cook_event).toBeGreaterThan(0);
    expect(before.meal_plan).toBeGreaterThan(0);
    expect(before.shopping_list).toBeGreaterThan(0);
    expect(before.pantry_item).toBeGreaterThan(0);

    await job(app, 29);
    expect((await job(app, 30)).deleted).toEqual([householdId]);

    const after = counts();
    expect(Object.entries(after).filter(([, n]) => n !== 0)).toEqual([]);
  });
});
