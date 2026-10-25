import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "../src/lib/uploads";
import { openPanoramaDatabase } from "./panorama-store.mjs";
import { checkSameOrigin, errorResponse, HttpError, readLimitedBody } from "./http";
import { isCampusEmail, REVIEWER_EMAIL } from "../src/lib/accountPolicy.mjs";

const deriveKey = promisify(scrypt);
const SESSION_COOKIE = "hunter_session";
const SESSION_SECONDS = 24 * 60 * 60;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const key = await deriveKey(password, parts[1], 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(parts[2], "hex"));
}

function sessionToken(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export function sessionUser(database: DatabaseSync, request: Request): SessionUser | null {
  const token = sessionToken(request);
  if (!token) return null;
  const row = database.prepare(`SELECT users.id, users.name, users.email, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash(token), Math.floor(Date.now() / 1000));
  return row ? { id: Number(row.id), name: String(row.name), email: String(row.email), role: row.role as SessionUser["role"] } : null;
}

export function requireUser(database: DatabaseSync, request: Request) {
  const user = sessionUser(database, request);
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  return user;
}

function cookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

export function startSession(database: DatabaseSync, userId: number, request: Request) {
  const previous = sessionToken(request);
  if (previous) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(previous));
  const now = Math.floor(Date.now() / 1000);
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  const token = randomBytes(32).toString("hex");
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash(token), userId, now + SESSION_SECONDS);
  return cookie(request, token);
}

export async function handleAuth(request: Request, action: string) {
  const database = openPanoramaDatabase();
  try {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (request.method === "GET" && action === "session") return Response.json({ user: sessionUser(database, request) }, { headers });
    if (request.method !== "POST" || !["sign-up", "sign-in", "sign-out"].includes(action)) throw new HttpError(404, "Not found.");
    checkSameOrigin(request);
    if (action === "sign-out") {
      const token = sessionToken(request);
      if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
      headers["Set-Cookie"] = cookie(request, "", 0);
      return Response.json({ user: null }, { headers });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse((await readLimitedBody(request, 8192)).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "Enter your account details.");
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isCampusEmail(email)) throw new HttpError(400, "Use your @login.cuny.edu email address.");
    if (password.length < 8 || password.length > 100) {
      throw new HttpError(400, "Use a password between 8 and 100 characters.");
    }
    let user: SessionUser;
    if (action === "sign-up") {
      if (email === REVIEWER_EMAIL) throw new HttpError(403, "The reviewer account is created through local setup. Please sign in.");
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 50) throw new HttpError(400, "Enter a name of up to 50 characters.");
      const passwordHash = await hashPassword(password);
      const row = database.prepare(`INSERT INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, 'uploader') ON CONFLICT(email) DO NOTHING RETURNING id`).get(name, email, passwordHash);
      if (!row) throw new HttpError(409, "An account with that email already exists. Please sign in.");
      user = { id: Number(row.id), name, email, role: "uploader" };
    } else {
      const row = database.prepare("SELECT id, name, email, role, password_hash FROM users WHERE email = ?").get(email);
      // Derive a key even for an unknown email so the simple login path doesn't
      // immediately distinguish unknown accounts from incorrect passwords.
      const stored = row ? String(row.password_hash) : `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
      if (!await verifyPassword(password, stored) || !row) throw new HttpError(401, "Email or password is incorrect.");
      user = { id: Number(row.id), name: String(row.name), email: String(row.email), role: row.role as SessionUser["role"] };
    }
    headers["Set-Cookie"] = startSession(database, user.id, request);
    return Response.json({ user }, { status: action === "sign-up" ? 201 : 200, headers });
  } catch (error) { return errorResponse(error); }
  finally { database.close(); }
}
