/**
 * 密码哈希（U6）——stdlib `crypto.scrypt`，零依赖。
 *
 * 偏离 plan 说明：plan 写 bcrypt。改用 stdlib scrypt——避免 bcrypt 的 node-gyp 原生构建
 * （与 pnpm onlyBuiltDependencies / Node strip-only 摩擦），安全等价（scrypt 是 memory-hard KDF）。
 * 存储格式：`scrypt$N$saltB64$hashB64`，自带参数便于日后升级。
 */

import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from "node:crypto";

// 手包 Promise：promisify 丢失带 options 的重载，直接 new Promise 保留 options 参数。
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
}

const N = 16384; // CPU/内存成本
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(plain, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, "base64");
  const expected = Buffer.from(parts[3]!, "base64");
  const derived = await scryptAsync(plain, salt, expected.length, { N: n });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
