import { randomBytes, scryptSync } from "node:crypto";
import { REVIEWER_EMAIL } from "../src/lib/accountPolicy.mjs";

export const REVIEWER_DEMO_PASSWORD = "ReviewerDemo2026!";

/** Create the local demo reviewer once.
 * @param {import('node:sqlite').DatabaseSync} database
 */
export function ensureReviewer(database) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare("SELECT id, role FROM users WHERE email = ?").get(REVIEWER_EMAIL);
    if (existing && existing.role !== "reviewer") {
      throw new Error(`Setup conflict: ${REVIEWER_EMAIL} belongs to an uploader. No account was changed.`);
    }
    if (existing) {
      database.exec("COMMIT");
      return Number(existing.id);
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `scrypt:${salt}:${scryptSync(REVIEWER_DEMO_PASSWORD, salt, 64).toString("hex")}`;
    const row = database.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'reviewer') RETURNING id")
      .get("Demo reviewer", REVIEWER_EMAIL, passwordHash);
    database.exec("COMMIT");
    return Number(row.id);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
