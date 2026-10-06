import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql, transaction } from "./db";
import { HttpError } from "./http";
export const COOKIE = "ads_session";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export type User = { password: string; role: "operator" | "viewer" };
export function users(): Record<string, User> {
  if (process.env.ADMIN_USERS_JSON) {
    const config = JSON.parse(process.env.ADMIN_USERS_JSON) as Record<
      string,
      User
    >;
    if (
      !Object.keys(config).length ||
      Object.entries(config).some(
        ([name, u]) =>
          !/^[-a-zA-Z0-9_]{1,50}$/.test(name) ||
          typeof u.password !== "string" ||
          u.password.length < 16 ||
          !["operator", "viewer"].includes(u.role),
      )
    )
      throw new Error("Invalid ADMIN_USERS_JSON configuration");
    return config;
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return {};
  if (process.env.NODE_ENV === "production" && password.length < 16)
    throw new Error("ADMIN_PASSWORD requires at least 16 characters");
  return { admin: { password, role: "operator" } };
}
export async function session(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const config = users();
  const [row] =
    await sql`SELECT * FROM sessions WHERE token_hash=${hash(token)} AND expires_at>now()`;
  const user = row && config[row.user_name];
  return user &&
    row.secret_version === hash(user.password) &&
    row.role === user.role
    ? row
    : null;
}
export async function login(username: string, password: string) {
  const config = users();
  // Global limit cannot be evaded by spoofing IP headers or creating new usernames.
  return transaction(async (db) => {
    const [rate] =
      await db`INSERT INTO login_attempts(key,attempts,reset_at) VALUES('global',1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<=now() THEN 1 ELSE login_attempts.attempts+1 END, reset_at=CASE WHEN login_attempts.reset_at<=now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END RETURNING attempts`;
    if (rate.attempts > 30)
      return {
        error: "Too many login attempts. Try again in 15 minutes.",
        status: 429,
      } as const;
    const user = config[username];
    if (
      !equalSecret(password, user?.password ?? randomBytes(32).toString("hex"))
    )
      return { error: "Invalid credentials", status: 401 } as const;
    const token = randomBytes(32).toString("hex");
    await db`DELETE FROM sessions WHERE expires_at<=now()`;
    await db`INSERT INTO sessions(token_hash,secret_version,user_name,role,expires_at) VALUES(${hash(token)},${hash(user.password)},${username},${user.role},now()+interval '8 hours')`;
    return { token, status: 200 } as const;
  });
}
export function engineAuthorized(header: string | null) {
  const token = process.env.ENGINE_TOKEN;
  return (
    !!token &&
    token.length >= 32 &&
    equalSecret(header ?? "", `Bearer ${token}`)
  );
}
export function requireEngine(header: string | null) {
  if (!engineAuthorized(header))
    throw new HttpError(401, "Engine authorization required");
}
