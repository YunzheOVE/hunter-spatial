import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getDataDirectory, getProjectRoot, isKnownLocation, openPanoramaDatabase } from "../server/panorama-store.mjs";
import { ensureReviewer } from "../server/reviewer-seed.mjs";

if (!isKnownLocation("N304")) throw new Error("The development location N304 is missing.");
const database = openPanoramaDatabase();
try {
  // Check reviewer conflicts before touching the remaining seed records or files.
  const reviewerId = ensureReviewer(database);
  const uploads = path.join(getDataDirectory(), "uploads");
  mkdirSync(uploads, { recursive: true });
  copyFileSync(path.join(getProjectRoot(), "database/fixtures/example.webp"), path.join(uploads, "development-example.webp"));
  const existing = database.prepare("SELECT id FROM panoramas WHERE file_path = ?").get("uploads/development-example.webp");
  if (!existing) {
    database.prepare(`INSERT INTO panoramas
      (location_id, file_path, uploaded_by, status, haov, vaov, v_offset, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, 'approved', 270, 90, 0, ?, CURRENT_TIMESTAMP)
    `).run("N304", "uploads/development-example.webp", reviewerId, reviewerId);
  }
  console.log("Development example ready. Search N304 and click View in 360°. This is test imagery, not a verified N304 photo.");
  console.log("Reviewer ready. Initial local-demo credentials are documented in database/README.md (existing passwords are preserved).");
} finally {
  database.close();
}
