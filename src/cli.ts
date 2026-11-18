#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createAccount, getAccountByEmail, listAccounts, normalizeEmail, resetPassword } from "./auth/accounts.js";
import { createToken, listTokens, revokeToken } from "./auth/tokens.js";
import { makeCtx } from "./context.js";
import { openDb, runMigrations, type Db } from "./db/client.js";
import { households } from "./db/schema.js";
import { AppError, isAppError } from "./lib/errors.js";
import { createHousehold, getHousehold, type Household } from "./services/households.js";

const USAGE = `pantrypal — household pantry backend CLI

Usage:
  pantrypal migrate
  pantrypal household init --name <name> [--timezone <tz>]
  pantrypal household show [--household-id <id> | --email <email>]
  pantrypal account create --email <email> --household <name> [--password-stdin]
  pantrypal account create --email <email> --household-id <id> [--password-stdin]
  pantrypal account reset-password <email> [--password-stdin]
  pantrypal account list
  pantrypal token create --name <name> [--household-id <id> | --email <email>]
  pantrypal token list [--household-id <id> | --email <email>]
  pantrypal token revoke <token-id> [--household-id <id> | --email <email>]
  pantrypal seed <file.json> [--force] [--household-id <id> | --email <email>]

Global options:
  --db <path>   SQLite file (default: $PANTRYPAL_DB_PATH or ./data/pantrypal.db)
  --help        Show this help

Passwords are read from the terminal unless --password-stdin is set, in which
case the first line of standard input is used.

Household commands take --household-id or --email when the instance has more
than one household. With exactly one, it is the default.

All commands run pending migrations first.`;

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
  help: boolean;
}

const VALUE_FLAGS: Record<string, true> = {
  db: true,
  name: true,
  timezone: true,
  email: true,
  household: true,
  "household-id": true,
};
const BOOLEAN_FLAGS: Record<string, true> = { force: true, "password-stdin": true };

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

/**
 * The household a command should act on: an explicit `--household-id` or
 * `--email`, or the only household when the instance has exactly one.
 */
function selectHousehold(db: Db, flags: Record<string, string>): Household {
  const id = flags["household-id"];
  if (id !== undefined) return getHousehold(db, id);

  const email = flags.email;
  if (email !== undefined) {
    const account = getAccountByEmail(db, email);
    if (!account) throw new AppError("not_found", `Account not found: ${normalizeEmail(email)}`);
    return getHousehold(db, account.householdId);
  }

  const rows = db.select().from(households).limit(2).all();
  if (rows.length === 0) {
    throw new AppError("not_found", "No household configured", {
      hint: "Run `pantrypal account create --email <email> --household <name>` to create one.",
    });
  }
  if (rows.length > 1) {
    throw new AppError(
      "validation",
      "This instance has more than one household; pass --household-id <id> or --email <email>.",
    );
  }
  return rows[0]!;
}

/** Read a hidden password from a TTY, or the first line of piped input. */
async function readPassword(flags: Record<string, string>): Promise<string> {
  if (flags["password-stdin"] === "true") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
  }
  if (!process.stdin.isTTY) {
    throw new AppError("validation", "No terminal for a password prompt; pass --password-stdin");
  }

  process.stdout.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  // Not `for await`: leaving that loop destroys stdin, which breaks the confirmation prompt.
  return new Promise<string>((resolve, reject) => {
    let password = "";
    const finish = (done: () => void): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      done();
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(() => resolve(password));
        if (char === "\u0003") {
          return finish(() => reject(new AppError("validation", "Cancelled")));
        }
        if (char === "\u007f") password = password.slice(0, -1);
        else if (char >= " ") password += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function readNewPassword(flags: Record<string, string>): Promise<string> {
  const password = await readPassword(flags);
  if (password.length < 8) {
    throw new AppError("validation", "Password must be at least 8 characters");
  }
  if (flags["password-stdin"] !== "true" && (await readPassword(flags)) !== password) {
    throw new AppError("validation", "Passwords do not match");
  }
  return password;
}

function runHouseholdInit(db: Db, flags: Record<string, string>): void {
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

function runHouseholdShow(db: Db, flags: Record<string, string>): void {
  print(selectHousehold(db, flags));
}

async function runAccountCreate(db: Db, flags: Record<string, string>): Promise<void> {
  const email = flags.email;
  if (email === undefined) {
    throw new AppError("validation", "Missing required option: --email <email>");
  }
  const householdId = flags["household-id"];
  const householdName = flags.household;
  if ((householdId === undefined) === (householdName === undefined)) {
    throw new AppError(
      "validation",
      "Pass exactly one of --household <name> (new household) or --household-id <id> (existing).",
    );
  }

  const password = await readNewPassword(flags);
  const { account, household } = createAccount(
    db,
    email,
    password,
    householdId === undefined ? { householdName } : { householdId },
  );
  console.log(`Created account ${account.email} for household ${household.name}.`);
  print({
    account: { id: account.id, email: account.email },
    household: { id: household.id, name: household.name },
  });
}

async function runAccountResetPassword(
  db: Db,
  email: string | undefined,
  flags: Record<string, string>,
): Promise<void> {
  if (email === undefined) {
    throw new AppError(
      "validation",
      "Missing email: pantrypal account reset-password <email>",
    );
  }
  const password = await readNewPassword(flags);
  const account = resetPassword(db, email, password);
  console.log(`Password reset for ${account.email}. Existing sessions were ended.`);
}

function runAccountList(db: Db): void {
  print({ items: listAccounts(db) });
}

function runTokenCreate(db: Db, flags: Record<string, string>): void {
  const name = flags.name;
  if (name === undefined) {
    throw new AppError("validation", "Missing required option: --name <name>");
  }
  const household = selectHousehold(db, flags);
  const created = createToken(db, household.id, name);
  console.log("Token created. Copy it now — it is shown only once:");
  console.log("");
  console.log(`  ${created.token}`);
  console.log("");
  print(created);
}

function runTokenList(db: Db, flags: Record<string, string>): void {
  const household = selectHousehold(db, flags);
  print({ items: listTokens(db, household.id) });
}

function runTokenRevoke(db: Db, id: string | undefined, flags: Record<string, string>): void {
  if (id === undefined) {
    throw new AppError("validation", "Missing token id: pantrypal token revoke <token-id>");
  }
  const household = selectHousehold(db, flags);
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
    household = selectHousehold(db, flags);
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
        if (second === "show") return runHouseholdShow(db, flags);
        throw new AppError("validation", `Unknown household command: ${second ?? "(none)"}`);
      case "account":
        if (second === "create") return await runAccountCreate(db, flags);
        if (second === "reset-password") return await runAccountResetPassword(db, rest[0], flags);
        if (second === "list") return runAccountList(db);
        throw new AppError("validation", `Unknown account command: ${second ?? "(none)"}`);
      case "token":
        if (second === "create") return runTokenCreate(db, flags);
        if (second === "list") return runTokenList(db, flags);
        if (second === "revoke") return runTokenRevoke(db, rest[0], flags);
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
