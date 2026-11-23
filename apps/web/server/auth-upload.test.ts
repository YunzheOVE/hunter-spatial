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
import { handleReviews } from "./reviews";
import { uploadQuota } from "./upload-quota";

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

describe("daily upload quota", () => {
  it("limits both roles, counts reviewed submissions, and returns allowance through the API", async () => {
    for (const role of ["uploader", "reviewer"]) {
      const { cookie, user } = await signUp(`quota-${role}@login.cuny.edu`);
      database.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, user.id);
      const first = await saveSubmission(database, form(), user.id, directory);
      database.prepare("UPDATE panoramas SET status = 'rejected' WHERE id = ?").run(first.id);
      const second = await saveSubmission(database, form(), user.id, directory);
      database.prepare("UPDATE panoramas SET status = 'approved' WHERE id = ?").run(second.id);
      const list = await handleSubmissions(new Request(`${baseUrl}/api/submissions`, { headers: { Cookie: cookie } }));
      expect((await list.json()).quota).toMatchObject({ limit: 2, remaining: 0 });
      const blocked = await handleSubmissions(new Request(`${baseUrl}/api/submissions`, { method: "POST", headers: { Cookie: cookie }, body: form() }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();
      expect((await blocked.json()).quota.remaining).toBe(0);
    }
  });

  it("accepts only two concurrent uploads across connections and removes excess files", async () => {
    const { user } = await signUp();
    const connections = [openDatabase(databasePath), openDatabase(databasePath), openDatabase(databasePath)];
    try {
      const results = await Promise.allSettled(connections.map((connection) => saveSubmission(connection, form(), user.id, directory)));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 429 } });
      expect(readdirSync(path.join(directory, "uploads"))).toHaveLength(2);
      expect(uploadQuota(database, user.id).remaining).toBe(0);
    } finally { connections.forEach((connection) => connection.close()); }
  });

  it("does not consume allowance for invalid images or failed database inserts", async () => {
    const { user, cookie } = await signUp();
    await expect(saveSubmission(database, form({ image: new File(["broken"], "bad.png") }), user.id, directory)).rejects.toMatchObject({ status: 400 });
    database.exec("CREATE TRIGGER fail_quota_insert BEFORE INSERT ON panoramas BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await expect(saveSubmission(database, form(), user.id, directory)).rejects.toThrow("test failure");
    expect(uploadQuota(database, user.id).remaining).toBe(2);
    expect(database.isTransaction).toBe(false);
    expect(readdirSync(path.join(directory, "uploads"))).toEqual([]);
    database.exec("DROP TRIGGER fail_quota_insert");
    const response = await handleSubmissions(new Request(`${baseUrl}/api/submissions`, { method: "POST", headers: { Cookie: cookie }, body: form() }));
    expect(response.status).toBe(201);
    expect((await response.json()).quota.remaining).toBe(1);
  });

  it.each([
    ["2026-01-15T04:59:59Z", "2026-01-15T05:00:00.000Z"],
    ["2026-01-15T05:00:00Z", "2026-01-16T05:00:00.000Z"],
    ["2026-03-08T06:00:00Z", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01T06:00:00Z", "2026-11-02T05:00:00.000Z"],
  ])("uses New York midnight including daylight saving at %s", async (now, reset) => {
    const { user } = await signUp();
    expect(uploadQuota(database, user.id, new Date(now)).resetsAt).toBe(reset);
  });

  it("restores the allowance at midnight and excludes records at the next day's boundary", async () => {
    const { user } = await signUp();
    const first = await saveSubmission(database, form(), user.id, directory);
    const second = await saveSubmission(database, form(), user.id, directory);
    database.prepare("UPDATE panoramas SET uploaded_at = ? WHERE id = ?").run("2026-01-15 04:59:59", first.id);
    database.prepare("UPDATE panoramas SET uploaded_at = ? WHERE id = ?").run("2026-01-15 04:59:59", second.id);
    expect(uploadQuota(database, user.id, new Date("2026-01-15T04:59:59Z")).remaining).toBe(0);
    expect(uploadQuota(database, user.id, new Date("2026-01-15T05:00:00Z")).remaining).toBe(2);
  });
});

describe("review decisions", () => {
  async function setup() {
    const uploader = await signUp();
    const reviewerId = ensureReviewer(database);
    const response = await handleAuth(authRequest("sign-in", { email: REVIEWER_EMAIL, password: REVIEWER_DEMO_PASSWORD }), "sign-in");
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const submission = await saveSubmission(database, form(), uploader.user.id, directory);
    return { uploader, reviewerId, cookie, submission };
  }
  function request(cookie: string, decision?: unknown, origin?: string) {
    return new Request(`${baseUrl}/api/reviews`, { method: decision === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) }, ...(decision === undefined ? {} : { body: JSON.stringify({ decision }) }) });
  }
  it("restricts listing and decisions to reviewers and lists oldest pending first", async () => {
    const { uploader, cookie, submission } = await setup();
    expect((await handleReviews(request(""))).status).toBe(401);
    expect((await handleReviews(request("", "approved"), String(submission.id))).status).toBe(401);
    expect((await handleReviews(request(uploader.cookie))).status).toBe(403);
    expect((await handleReviews(request(uploader.cookie, "approved"), String(submission.id))).status).toBe(403);
    const second = await saveSubmission(database, form(), uploader.user.id, directory);
    const queue = await (await handleReviews(request(cookie))).json();
    expect(queue.submissions.map((s: { id: number }) => s.id)).toEqual([submission.id, second.id]);
    expect(queue.submissions[0].uploaderName).toBe("Student");
    expect(queue.submissions[0]).not.toHaveProperty("file_path");
  });
  it("records a single decision, publishes approvals, and preserves the approved image after rejection", async () => {
    const { uploader, reviewerId, cookie, submission } = await setup();
    expect((await handleReviews(request(cookie, "approved"), String(submission.id))).status).toBe(200);
    const row = database.prepare("SELECT * FROM panoramas WHERE id = ?").get(submission.id)!;
    expect(row.reviewed_by).toBe(reviewerId);
    expect(row.reviewed_at).toBeTruthy();
    expect(store.findApprovedPanorama(database, "N304")?.id).toBe(submission.id);
    expect((await handleReviews(request(cookie, "rejected"), String(submission.id))).status).toBe(409);
    const second = await saveSubmission(database, form(), uploader.user.id, directory);
    expect((await handleReviews(request(cookie, "rejected"), String(second.id))).status).toBe(200);
    expect(store.findApprovedPanorama(database, "N304")?.id).toBe(submission.id);
    expect((await (await handleReviews(request(cookie))).json()).submissions).toEqual([]);
  });
  it("rejects invalid decisions, IDs, missing records, and cross-origin decisions", async () => {
    const { cookie, submission } = await setup();
    expect((await handleReviews(request(cookie, "other"), String(submission.id))).status).toBe(400);
    expect((await handleReviews(request(cookie, "approved"), "bad")).status).toBe(400);
    expect((await handleReviews(request(cookie, "approved"), "999999")).status).toBe(404);
    expect((await handleReviews(request(cookie, "approved", "https://elsewhere.example"), String(submission.id))).status).toBe(403);
    expect((await handleReviews(new Request(`${baseUrl}/api/reviews`, { method: "POST", headers: { Cookie: cookie }, body: "broken" }), String(submission.id))).status).toBe(400);
  });
  it("accepts only one competing decision and makes the next approval the current panorama", async () => {
    const { uploader, cookie, submission } = await setup();
    const responses = await Promise.all([
      handleReviews(request(cookie, "approved"), String(submission.id)),
      handleReviews(request(cookie, "rejected"), String(submission.id)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const next = await saveSubmission(database, form(), uploader.user.id, directory);
    expect((await handleReviews(request(cookie, "approved"), String(next.id))).status).toBe(200);
    expect(store.findApprovedPanorama(database, "N304")?.id).toBe(next.id);
  });
});

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

  it("enforces full-sphere proportions on the backend while accepting partial images", async () => {
    const { user } = await signUp();
    const square = await sharp({ create: { width: 64, height: 64, channels: 3, background: "purple" } }).png().toBuffer();
    const image = new File([new Uint8Array(square)], "square.png", { type: "image/png" });
    await expect(saveSubmission(database, form({ image, haov: "360", vaov: "180" }), user.id, directory)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("2:1") });
    expect(readdirSync(path.join(directory, "uploads"))).toEqual([]);
    expect(await saveSubmission(database, form({ image }), user.id, directory)).toMatchObject({ status: "pending" });
    expect(await saveSubmission(database, form({ haov: "360", vaov: "180" }), user.id, directory)).toMatchObject({ status: "pending" });
  });

});
