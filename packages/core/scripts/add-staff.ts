// Creates the web interface account of a team member, or sets a new password. The password is read
// from the terminal without being shown, or from standard input, never from the command line,
// which would keep it in the shell history.
// Usage: pnpm staff:add --email dana@team.example --name "Dana Support"
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";

import { z } from "zod";

import { connectDatabase } from "../src/db/client.ts";
import { loadAppDatabaseEnv } from "../src/env.ts";
import { minPasswordLength, saveStaffAccount, staffAccountInput } from "../src/staff/accounts.ts";

const enter = new Set(["\r", "\n"]);
const ctrlC = "\u0003";
const backspaces = new Set(["\u007f", "\b"]);

// Reads one line typed in the terminal without echoing it.
function readHiddenLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let line = "";
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      if (error === undefined) {
        resolve(line);
      } else {
        reject(error);
      }
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (enter.has(character)) {
          finish();
          return;
        }
        if (character === ctrlC) {
          finish(new Error("Cancelled"));
          return;
        }
        line = backspaces.has(character) ? line.slice(0, -1) : line + character;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  return (await text(process.stdin)).replace(/\r?\n$/, "");
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return readPiped();
  }
  process.stdout.write(`Password (at least ${minPasswordLength} characters, not shown): `);
  const password = await readHiddenLine();
  process.stdout.write("Same password again: ");
  if ((await readHiddenLine()) !== password) {
    throw new Error("The two passwords differ");
  }
  return password;
}

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});
let password: string;
try {
  password = await readPassword();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const input = staffAccountInput.safeParse({ ...values, password });
if (!input.success) {
  console.error(`Invalid account:\n${z.prettifyError(input.error)}`);
  process.exit(1);
}

const { APP_DATABASE_URL } = loadAppDatabaseEnv();
const { db, close } = connectDatabase(APP_DATABASE_URL);
try {
  await saveStaffAccount(db, input.data);
  console.info(`Account of ${input.data.email} saved.`);
} finally {
  await close();
}
