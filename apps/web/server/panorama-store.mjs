import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Next runs from apps/web; npm scripts and tests may run from the project root.
export function getProjectRoot() {
  let directory = process.cwd();
  while (true) {
    const manifest = path.join(directory, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "hunter-spatial") {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("Cannot locate the Hunter Spatial project root.");
    directory = parent;
  }
}

export function getDataDirectory() {
  return path.join(getProjectRoot(), "local-data");
}

export function openPanoramaDatabase(databasePath = path.join(getDataDirectory(), "app.sqlite")) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(readFileSync(path.join(getProjectRoot(), "database/schema.sql"), "utf8"));
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

let locations;
export function isKnownLocation(locationId) {
  locations ??= JSON.parse(readFileSync(path.join(getProjectRoot(), "apps/web/public/data/routing-graph.json"), "utf8")).rooms;
  return Object.hasOwn(locations, locationId);
}

/** @param {DatabaseSync} database @param {string} locationId */
export function findApprovedPanorama(database, locationId) {
  const row = database.prepare(`
    SELECT id, location_id, file_path, haov, vaov, v_offset
    FROM panoramas
    WHERE location_id = ? AND status = 'approved'
    ORDER BY reviewed_at DESC, id DESC
    LIMIT 1
  `).get(locationId);
  if (!row) return null;
  return {
    id: Number(row.id),
    locationId: String(row.location_id),
    imageUrl: `/api/panoramas/${row.id}/image`,
    haov: Number(row.haov),
    vaov: Number(row.vaov),
    vOffset: Number(row.v_offset),
    isDemo: row.file_path === "uploads/development-example.webp",
  };
}

/** @param {DatabaseSync} database @param {number} id */
export function findApprovedImage(database, id) {
  const row = database.prepare("SELECT file_path FROM panoramas WHERE id = ? AND status = 'approved'").get(id);
  return row ? String(row.file_path) : null;
}

/** @param {DatabaseSync} database @param {number} id @param {number | null} userId @param {boolean} reviewer */
export function findVisibleImage(database, id, userId, reviewer = false) {
  const row = database.prepare(`SELECT file_path FROM panoramas
    WHERE id = ? AND (status = 'approved' OR uploaded_by = ? OR ? = 1)`)
    .get(id, userId, reviewer ? 1 : 0);
  return row ? String(row.file_path) : null;
}

// Never interpret a stored path as an unrestricted filesystem path, even if a
// database record is manually edited. Resolve symlinks before checking containment.
export function resolveImagePath(filePath, dataDirectory = getDataDirectory()) {
  const uploads = realpathSync(path.join(dataDirectory, "uploads"));
  const target = realpathSync(path.resolve(dataDirectory, filePath));
  const relative = path.relative(uploads, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Image path is outside the uploads directory.");
  }
  return target;
}
