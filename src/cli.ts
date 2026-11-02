#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createToken, listTokens, revokeToken } from "./auth/tokens.js";
import { makeCtx } from "./context.js";
import { openDb, runMigrations, type Db } from "./db/client.js";
import { AppError, isAppError } from "./lib/errors.js";
import { createHousehold, getSingleHousehold, type Household } from "./services/households.js";

const USAGE = `pantrypal — household pantry backend CLI

Usage:
  pantrypal migrate
  pantrypal household init --name <name> [--timezone <tz>]
  pantrypal household show
  pantrypal token create --name <name>
  pantrypal token list
  pantrypal token revoke <token-id>
  pantrypal seed <file.json> [--force]

Global options:
  --db <path>   SQLite file (default: $PANTRYPAL_DB_PATH or ./data/pantrypal.db)
  --help        Show this help

All commands run pending migrations first.`;

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
  help: boolean;
}

const VALUE_FLAGS: Record<string, true> = { db: true, name: true, timezone: true };
const BOOLEAN_FLAGS: Record<string, true> = { force: true };

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const withoutPrefix = arg.slice(2);
      const eq = withoutPrefix.indexOf("=");
      const key = eq === -1 ? withoutPrefix : withoutPrefix.slice(0, eq);
      if (eq !== -1) {
        flags[key] = withoutPrefix.slice(eq + 1);
        continue;
      }
      if (BOOLEAN_FLAGS[key]) {
        flags[key] = "true";
        continue;
      }
      if (VALUE_FLAGS[key]) {
        const value = argv[i + 1];
        if (value === undefined) {
          throw new AppError("validation", `Missing value for --${key}`);
        }
        flags[key] = value;
        i++;
        continue;
      }
      throw new AppError("validation", `Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  return { positionals, flags, help };
}

function dbPathFrom(flags: Record<string, string>): string {
  return flags.db ?? process.env.PANTRYPAL_DB_PATH ?? "./data/pantrypal.db";
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function runHouseholdInit(db: Db, flags: Record<string, string>): void {
  let existing: Household | null = null;
  try {
    existing = getSingleHousehold(db);
  } catch (error) {
    if (!(isAppError(error) && error.code === "not_found")) throw error;
  }
  if (existing) {
    throw new AppError("conflict", "A household already exists; this instance supports exactly one.", {
      hint: "Use `pantrypal household show` to inspect it.",
    });
  }

  const name = flags.name;
  if (name === undefined) {
    throw new AppError("validation", "Missing required option: --name <name>");
  }
  const household = createHousehold(db, {
    name,
    ...(flags.timezone === undefined ? {} : { timezone: flags.timezone }),
  });
  console.log(`Created household ${household.name} (${household.id}).`);
  print(household);
}

function runHouseholdShow(db: Db): void {
  print(getSingleHousehold(db));
}

function runTokenCreate(db: Db, flags: Record<string, string>): void {
  const name = flags.name;
  if (name === undefined) {
    throw new AppError("validation", "Missing required option: --name <name>");
  }
  const household = getSingleHousehold(db);
  const created = createToken(db, household.id, name);
  console.log("Token created. Copy it now — it is shown only once:");
  console.log("");
  console.log(`  ${created.token}`);
  console.log("");
  print(created);
}

function runTokenList(db: Db): void {
  const household = getSingleHousehold(db);
  print({ items: listTokens(db, household.id) });
}

function runTokenRevoke(db: Db, id: string | undefined): void {
  if (id === undefined) {
    throw new AppError("validation", "Missing token id: pantrypal token revoke <token-id>");
  }
  const household = getSingleHousehold(db);
  const revoked = revokeToken(db, household.id, id);
  console.log(`Revoked token ${revoked.id}.`);
  print(revoked);
}

async function runSeed(
  db: Db,
  file: string | undefined,
  flags: Record<string, string>,
): Promise<void> {
  if (file === undefined) {
    throw new AppError("validation", "Missing seed file: pantrypal seed <file.json>");
  }
  const raw = await readFile(file, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AppError("validation", `Seed file is not valid JSON: ${file}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  // Lazy by requirement: the seed schema and loader are a large, optional
  // stack that the other CLI commands (and `migrate` in particular) must not
  // pull in. Validate before creating anything, so a malformed seed cannot
  // leave a stray household behind.
  const { parseSeed } = await import("./schemas/seed.js");
  const seed = parseSeed(data);

  let household: Household;
  try {
    household = getSingleHousehold(db);
  } catch (error) {
    if (!(isAppError(error) && error.code === "not_found")) throw error;
    household = createHousehold(db, {
      name: seed.household.name,
      timezone: seed.household.timezone,
    });
  }

  const { loadSeed } = await import("./seed/load.js");
  const ctx = makeCtx(db, household.id);
  const result = loadSeed(ctx, data, { force: flags.force === "true" });
  console.log("Seed loaded.");
  print(result);
}

async function main(argv: string[]): Promise<void> {
  const { positionals, flags, help } = parseArgs(argv);
  if (help || positionals.length === 0) {
    console.log(USAGE);
    return;
  }

  const dbPath = dbPathFrom(flags);
  const { db, sqlite } = openDb(dbPath);
  try {
    runMigrations(db);

    const [first, second, ...rest] = positionals;
    switch (first) {
      case "migrate":
        console.log("Migrations applied.");
        return;
      case "household":
        if (second === "init") return runHouseholdInit(db, flags);
        if (second === "show") return runHouseholdShow(db);
        throw new AppError("validation", `Unknown household command: ${second ?? "(none)"}`);
      case "token":
        if (second === "create") return runTokenCreate(db, flags);
        if (second === "list") return runTokenList(db);
        if (second === "revoke") return runTokenRevoke(db, rest[0]);
        throw new AppError("validation", `Unknown token command: ${second ?? "(none)"}`);
      case "seed":
        return await runSeed(db, second, flags);
      default:
        throw new AppError("validation", `Unknown command: ${first}`, { usage: USAGE });
    }
  } finally {
    sqlite.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (isAppError(error)) {
    console.error(`Error [${error.code}]: ${error.message}`);
    if (error.details !== undefined) console.error(JSON.stringify(error.details, null, 2));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
