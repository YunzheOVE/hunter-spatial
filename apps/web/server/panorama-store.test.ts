import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./panorama-store.mjs";
import { GET as getPanorama } from "../src/app/api/panoramas/route";
import { GET as getImage } from "../src/app/api/panoramas/[id]/image/route";

let directory: string;
let database: ReturnType<typeof store.openPanoramaDatabase>;
let databasePath: string;
const openDatabase = store.openPanoramaDatabase;
const resolveImage = store.resolveImagePath;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "hunter-panorama-test-"));
  databasePath = path.join(directory, "app.sqlite");
  mkdirSync(path.join(directory, "uploads"));
  database = openDatabase(databasePath);
  database.exec(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Uploader', 'upload@example.invalid', 'fixture-hash', 'uploader'),
           (2, 'Reviewer', 'review@example.invalid', 'fixture-hash', 'reviewer')`);
  vi.spyOn(store, "openPanoramaDatabase").mockImplementation(() => openDatabase(databasePath));
  vi.spyOn(store, "resolveImagePath").mockImplementation((file) => resolveImage(file, directory));
});

afterEach(() => {
  vi.restoreAllMocks();
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function addPanorama(id: number, status: string, reviewedAt: string | null = null, filePath = `uploads/${id}.webp`) {
  database.prepare(`INSERT INTO panoramas
    (id, location_id, file_path, uploaded_by, status, haov, vaov, reviewed_by, reviewed_at)
    VALUES (?, 'N304', ?, 1, ?, 270, 90, ?, ?)`)
    .run(id, filePath, status, reviewedAt ? 2 : null, reviewedAt);
}

describe("persistent panorama storage", () => {
  it("preserves records across initialization and enables foreign keys on each connection", () => {
    addPanorama(1, "pending");
    const reopened = openDatabase(databasePath);
    try {
      expect(reopened.prepare("SELECT count(*) AS count FROM panoramas").get()?.count).toBe(1);
      expect(reopened.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
      expect(() => reopened.prepare("UPDATE panoramas SET uploaded_by = 999 WHERE id = 1").run()).toThrow();
    } finally {
      reopened.close();
    }
  });

  it("returns null without approval and excludes pending and rejected submissions", () => {
    addPanorama(1, "pending");
    addPanorama(2, "rejected", "2026-10-12 12:00:00");
    expect(store.findApprovedPanorama(database, "N304")).toBeNull();
    expect(store.findApprovedImage(database, 1)).toBeNull();
    expect(store.findApprovedImage(database, 2)).toBeNull();
  });

  it("uses approval time rather than upload time and breaks ties by image ID", () => {
    addPanorama(1, "approved", "2026-10-12 12:00:00");
    addPanorama(2, "approved", "2026-10-11 12:00:00");
    addPanorama(3, "approved", "2026-10-12 12:00:00");
    addPanorama(4, "pending");
    addPanorama(5, "rejected", "2026-10-13 12:00:00");
    const selected = store.findApprovedPanorama(database, "N304");
    expect(selected).toMatchObject({ id: 3, locationId: "N304", imageUrl: "/api/panoramas/3/image", haov: 270, vaov: 90, vOffset: 0 });
    expect(selected).not.toHaveProperty("file_path");
    expect(store.findApprovedPanorama(database, "W305")).toBeNull();
  });

  it("recognizes actual location IDs without accepting invented or inherited keys", () => {
    expect(store.isKnownLocation("N304")).toBe(true);
    expect(store.isKnownLocation("invented-room")).toBe(false);
    expect(store.isKnownLocation("toString")).toBe(false);
  });
});

describe("panorama read endpoints", () => {
  it("requires a known location and returns null for a valid empty location", async () => {
    expect(getPanorama(new Request("http://localhost/api/panoramas")).status).toBe(400);
    expect(getPanorama(new Request("http://localhost/api/panoramas?locationId=unknown")).status).toBe(404);
    const response = getPanorama(new Request("http://localhost/api/panoramas?locationId=N304"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toBeNull();
  });

  it("returns approved metadata and bytes while refusing unpublished images", async () => {
    addPanorama(1, "approved", "2026-10-12 12:00:00");
    addPanorama(2, "pending");
    addPanorama(3, "rejected", "2026-10-12 12:00:00");
    const bytes = Buffer.from("image-fixture");
    writeFileSync(path.join(directory, "uploads/1.webp"), bytes);
    const metadata = await getPanorama(new Request("http://localhost/api/panoramas?locationId=N304")).json();
    expect(metadata.id).toBe(1);
    const response = await getImage(new Request("http://localhost"), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    for (const id of ["2", "3", "999", "../1", "1.0"]) {
      expect((await getImage(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(404);
    }
  });

  it("handles missing files and refuses stored paths outside uploads", async () => {
    addPanorama(1, "approved", "2026-10-12 12:00:00");
    addPanorama(2, "approved", "2026-10-12 12:00:00", "app.sqlite");
    for (const id of ["1", "2"]) {
      expect((await getImage(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(404);
    }
    expect(readFileSync(databasePath).length).toBeGreaterThan(0);
  });
});
