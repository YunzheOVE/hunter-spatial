import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./panorama-store.mjs";
import { handleAuth, hashPassword, sessionUser, startSession, verifyPassword } from "./auth";
import { handleSubmissions, saveSubmission } from "./submissions";
import { GET as getImage } from "../src/app/api/panoramas/[id]/image/route";
import { MAX_PANORAMA_BYTES } from "../src/lib/uploads";
import { checkSameOrigin, readLimitedBody } from "./http";
import { isCampusEmail, REVIEWER_EMAIL } from "../src/lib/accountPolicy.mjs";
import { ensureReviewer, REVIEWER_DEMO_PASSWORD } from "./reviewer-seed.mjs";

let directory: string;
let database: ReturnType<typeof store.openPanoramaDatabase>;
let databasePath: string;
let imageBytes: Buffer;
const openDatabase = store.openPanoramaDatabase;
const resolveImage = store.resolveImagePath;
const baseUrl = "http://localhost";

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "hunter-auth-test-"));
  databasePath = path.join(directory, "app.sqlite");
  mkdirSync(path.join(directory, "uploads"));
  database = openDatabase(databasePath);
  vi.spyOn(store, "openPanoramaDatabase").mockImplementation(() => openDatabase(databasePath));
  vi.spyOn(store, "getDataDirectory").mockReturnValue(directory);
  vi.spyOn(store, "resolveImagePath").mockImplementation((file) => resolveImage(file, directory));
  imageBytes = await sharp({ create: { width: 64, height: 32, channels: 3, background: "purple" } }).png().toBuffer();
});

afterEach(() => { vi.restoreAllMocks(); database.close(); rmSync(directory, { recursive: true, force: true }); });

function authRequest(action: string, body?: unknown, cookie = "") {
  return new Request(`${baseUrl}/api/auth/${action}`, {
    method: action === "session" ? "GET" : "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signUp(email = "student@login.cuny.edu") {
  const response = await handleAuth(authRequest("sign-up", { name: "Student", email, password: "test-password-123", role: "reviewer" }), "sign-up");
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", user: (await response.json()).user };
}

function form(overrides: Record<string, string | File> = {}) {
  const data = new FormData();
  data.set("locationId", "N304"); data.set("haov", "270"); data.set("vaov", "90"); data.set("vOffset", "0");
  data.set("image", new File([new Uint8Array(imageBytes)], "panorama.png", { type: "image/png" }));
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

describe("simple account and session flow", () => {
  it("hashes passwords one way with a unique salt and verifies without JWT", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");
    expect(first).toMatch(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword("same-password", first)).toBe(true);
    expect(await verifyPassword("wrong-password", first)).toBe(false);
    expect(await verifyPassword("same-password", "broken-hash")).toBe(false);
  });

  it("signs up only as uploader, persists a hashed session, and signs out on the server", async () => {
    const { response, cookie, user } = await signUp();
    expect(response.status).toBe(201);
    expect(user.role).toBe("uploader");
    expect(user).not.toHaveProperty("password_hash");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
    const row = database.prepare("SELECT * FROM users WHERE id = ?").get(user.id)!;
    expect(row.password_hash).not.toBe("test-password-123");
    expect(await verifyPassword("test-password-123", String(row.password_hash))).toBe(true);
    const storedSession = database.prepare("SELECT token_hash FROM sessions").get()!;
    expect(cookie).not.toContain(String(storedSession.token_hash));
    expect((await (await handleAuth(authRequest("session", undefined, cookie), "session")).json()).user.id).toBe(user.id);
    const signedOut = await handleAuth(authRequest("sign-out", undefined, cookie), "sign-out");
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(sessionUser(database, authRequest("session", undefined, cookie))).toBeNull();
  });

  it("normalizes email, rejects duplicate sign-up, and supports sign-in with password checks", async () => {
    await signUp("Student@LOGIN.CUNY.EDU");
    const duplicate = await signUp("student@login.cuny.edu");
    expect(duplicate.response.status).toBe(409);
    for (const email of ["student@login.cuny.edu", "missing@login.cuny.edu"]) {
      expect((await handleAuth(authRequest("sign-in", { email, password: "incorrect-password" }), "sign-in")).status).toBe(401);
    }
    const signedIn = await handleAuth(authRequest("sign-in", { email: "STUDENT@LOGIN.CUNY.EDU", password: "test-password-123" }), "sign-in");
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("set-cookie")).toMatch(/^hunter_session=[a-f0-9]{64};/);
  });

  it("accepts the maximum field lengths and rejects values beyond them", async () => {
    const domain = "@login.cuny.edu";
    const details = { name: "N".repeat(50), email: "a".repeat(100 - domain.length) + domain, password: "p".repeat(100) };
    expect((await handleAuth(authRequest("sign-up", details), "sign-up")).status).toBe(201);
    expect((await handleAuth(authRequest("sign-in", details), "sign-in")).status).toBe(200);
    for (const invalid of [
      { ...details, name: "N".repeat(51) },
      { ...details, email: `a${details.email}` },
      { ...details, password: "p".repeat(101) },
      { ...details, password: "p".repeat(7) },
    ]) {
      expect((await handleAuth(authRequest("sign-up", invalid), "sign-up")).status).toBe(400);
    }
    expect((await handleAuth(authRequest("sign-in", { ...details, password: "p".repeat(101) }), "sign-in")).status).toBe(400);
  });

  it("rejects expired sessions, invalid input, and cross-origin state changes", async () => {
    const { cookie } = await signUp();
    database.exec("UPDATE sessions SET expires_at = 0");
    expect(sessionUser(database, authRequest("session", undefined, cookie))).toBeNull();
    expect((await handleAuth(authRequest("sign-up", { name: "Student", email: "invalid", password: "short" }), "sign-up")).status).toBe(400);
    const foreign = new Request(`${baseUrl}/api/auth/sign-out`, { method: "POST", headers: { Origin: "https://other.example", Cookie: cookie } });
    expect((await handleAuth(foreign, "sign-out")).status).toBe(403);
    const httpsRequest = new Request("https://localhost/api/auth/sign-in");
    const user = database.prepare("SELECT id FROM users LIMIT 1").get()!;
    expect(startSession(database, Number(user.id), httpsRequest)).toContain("; Secure");
    expect(() => checkSameOrigin(new Request("http://localhost:3102/api/auth/sign-in", {
      headers: { Host: "127.0.0.1:3102", Origin: "http://127.0.0.1:3102" },
    }))).not.toThrow();
    expect(() => checkSameOrigin(new Request("http://localhost:3102/api/auth/sign-in", {
      headers: { Host: "127.0.0.1:3102", Origin: "http://other.example" },
    }))).toThrow();
  });
});

describe("CUNY accounts and reviewer setup", () => {
  it("accepts only the exact CUNY login domain on sign-up and sign-in", async () => {
    expect(isCampusEmail("Student@LOGIN.CUNY.EDU")).toBe(true);
    for (const email of ["student@example.invalid", "student@admin.cuny.edu", "student@sub.login.cuny.edu", "student@login.cuny.edu.evil.test", "a@b@login.cuny.edu", "@login.cuny.edu"]) {
      expect(isCampusEmail(email)).toBe(false);
      for (const action of ["sign-up", "sign-in"]) {
        expect((await handleAuth(authRequest(action, { name: "Student", email, password: "test-password-123" }), action)).status).toBe(400);
      }
    }
    expect(database.prepare("SELECT count(*) AS count FROM users").get()?.count).toBe(0);
  });

  it("reserves the reviewer address before setup", async () => {
    const reserved = await handleAuth(authRequest("sign-up", { name: "Claim", email: REVIEWER_EMAIL.toUpperCase(), password: "test-password-123" }), "sign-up");
    expect(reserved.status).toBe(403);
  });

  it("creates a reviewer that can sign in, and preserves its password on repeated setup", async () => {
    const id = ensureReviewer(database);
    const original = database.prepare("SELECT * FROM users WHERE id = ?").get(id)!;
    expect(original.role).toBe("reviewer");
    expect(await verifyPassword(REVIEWER_DEMO_PASSWORD, String(original.password_hash))).toBe(true);
    const response = await handleAuth(authRequest("sign-in", { email: REVIEWER_EMAIL.toUpperCase(), password: REVIEWER_DEMO_PASSWORD }), "sign-in");
    expect(response.status).toBe(200);
    expect((await response.json()).user.role).toBe("reviewer");
    expect(ensureReviewer(database)).toBe(id);
    expect(database.prepare("SELECT password_hash FROM users WHERE id = ?").get(id)?.password_hash).toBe(original.password_hash);
    const replacement = await hashPassword("a-different-demo-password");
    database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(replacement, id);
    expect(ensureReviewer(database)).toBe(id);
    expect(database.prepare("SELECT password_hash FROM users WHERE id = ?").get(id)?.password_hash).toBe(replacement);
    expect(database.prepare("SELECT count(*) AS count FROM users").get()?.count).toBe(1);
  });

  it("reports a reserved-address conflict without promoting or modifying an uploader", async () => {
    const { user } = await signUp();
    database.prepare("UPDATE users SET email = ? WHERE id = ?").run(REVIEWER_EMAIL, user.id);
    const before = database.prepare("SELECT * FROM users").all();
    expect(() => ensureReviewer(database)).toThrow("belongs to an uploader");
    expect(database.prepare("SELECT * FROM users").all()).toEqual(before);
  });
});

describe("user panorama submissions", () => {
  it("requires sign-in before accepting uploads or listing submissions", async () => {
    expect((await handleSubmissions(new Request(`${baseUrl}/api/submissions`))).status).toBe(401);
    expect((await handleSubmissions(new Request(`${baseUrl}/api/submissions`, { method: "POST", body: form() }))).status).toBe(401);
  });

  it("saves original bytes as pending and uses the session's uploader regardless of submitted fields", async () => {
    const { cookie, user } = await signUp();
    const response = await handleSubmissions(new Request(`${baseUrl}/api/submissions`, {
      method: "POST", headers: { Cookie: cookie }, body: form({ uploaded_by: "999", status: "approved", reviewed_by: "999" }),
    }));
    expect(response.status).toBe(201);
    const { submission } = await response.json();
    expect(submission).toMatchObject({ locationId: "N304", status: "pending", haov: 270, vaov: 90, vOffset: 0, reviewedAt: null });
    expect(submission).not.toHaveProperty("file_path");
    const row = database.prepare("SELECT * FROM panoramas WHERE id = ?").get(submission.id)!;
    expect(row.uploaded_by).toBe(user.id);
    expect(row.reviewed_by).toBeNull();
    expect(String(row.file_path)).toMatch(/^uploads\/[a-f0-9-]+\.png$/);
    expect(readFileSync(path.join(directory, String(row.file_path)))).toEqual(imageBytes);
    expect(store.findApprovedPanorama(database, "N304")).toBeNull();
    const list = await (await handleSubmissions(new Request(`${baseUrl}/api/submissions`, { headers: { Cookie: cookie } }))).json();
    expect(list.submissions).toHaveLength(1);
    const other = await signUp("other@login.cuny.edu");
    expect((await (await handleSubmissions(new Request(`${baseUrl}/api/submissions`, { headers: { Cookie: other.cookie } }))).json()).submissions).toEqual([]);
    for (const status of ["pending", "rejected"]) {
      database.prepare("UPDATE panoramas SET status = ? WHERE id = ?").run(status, submission.id);
      const readImage = (credential = "") => getImage(new Request(baseUrl, { headers: { Cookie: credential } }), { params: Promise.resolve({ id: String(submission.id) }) });
      expect((await readImage()).status).toBe(404);
      expect((await readImage(other.cookie)).status).toBe(404);
      expect((await readImage(cookie)).status).toBe(200);
      database.prepare("UPDATE users SET role = 'reviewer' WHERE id = ?").run(other.user.id);
      expect((await readImage(other.cookie)).status).toBe(200);
      database.prepare("UPDATE users SET role = 'uploader' WHERE id = ?").run(other.user.id);
    }
  });

  it("validates selected locations, coverage, supported format, and decodability", async () => {
    const { user } = await signUp();
    const invalidCases: Record<string, string | File>[] = [
      { locationId: "invented-room" }, { locationId: "toString" }, { haov: "" }, { haov: "0.5" }, { vaov: "181" }, { vOffset: "80" }, { haov: "NaN" },
      { image: new File(["not-an-image"], "fake.jpg", { type: "image/jpeg" }) },
      { image: new File([new Uint8Array(imageBytes.subarray(0, 40))], "truncated.png", { type: "image/png" }) },
    ];
    for (const invalid of invalidCases) {
      await expect(saveSubmission(database, form(invalid), user.id, directory)).rejects.toMatchObject({ status: 400 });
    }
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).gif().toBuffer();
    await expect(saveSubmission(database, form({ image: new File([new Uint8Array(gif)], "test.gif") }), user.id, directory)).rejects.toMatchObject({ status: 400 });
    expect(readdirSync(path.join(directory, "uploads"))).toEqual([]);
  });

  it("enforces file/body limits and cleans up files when the database insert fails", async () => {
    const { user } = await signUp();
    const oversized = new File([new Uint8Array(MAX_PANORAMA_BYTES + 1)], "big.png", { type: "image/png" });
    await expect(saveSubmission(database, form({ image: oversized }), user.id, directory)).rejects.toMatchObject({ status: 413 });
    await expect(readLimitedBody(new Request(baseUrl, { method: "POST", body: "x".repeat(200) }), 100)).rejects.toMatchObject({ status: 413 });
    database.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON panoramas BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await expect(saveSubmission(database, form(), user.id, directory)).rejects.toThrow("test failure");
    expect(readdirSync(path.join(directory, "uploads"))).toEqual([]);
  });

});
