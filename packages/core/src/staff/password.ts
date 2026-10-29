import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

// Argon2id with the minimum parameters of the OWASP Password Storage Cheat Sheet: 19 MiB of
// memory, 2 passes, 1 lane.
const parameters = { memory: 19_456, passes: 2, parallelism: 1 };
const saltBytes = 16;
const hashBytes = 32;
// Version 1.3 of Argon2, the one Node.js implements.
const argon2Version = 19;

// Stored in the PHC string format, so the parameters can change without breaking older hashes.
const phcFormat = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w+/]+)\$([\w+/]+)$/;

function derive(
  password: string,
  salt: Buffer,
  settings: typeof parameters,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      { message: password, nonce: salt, tagLength: length, ...settings },
      (error, key) => {
        if (error === null) {
          resolve(key);
        } else {
          reject(error);
        }
      },
    );
  });
}

const encode = (bytes: Buffer) => bytes.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltBytes);
  const hash = await derive(password, salt, parameters, hashBytes);
  const { memory, passes, parallelism } = parameters;
  return `$argon2id$v=${argon2Version}$m=${memory},t=${passes},p=${parallelism}$${encode(salt)}$${encode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = phcFormat.exec(stored);
  if (match === null) {
    throw new Error("The stored password hash is not an Argon2id hash");
  }
  const [, memory, passes, parallelism, salt = "", expected = ""] = match;
  const expectedHash = Buffer.from(expected, "base64");
  const hash = await derive(
    password,
    Buffer.from(salt, "base64"),
    { memory: Number(memory), passes: Number(passes), parallelism: Number(parallelism) },
    expectedHash.length,
  );
  return timingSafeEqual(hash, expectedHash);
}
