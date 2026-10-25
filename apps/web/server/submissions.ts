import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import type { DatabaseSync } from "node:sqlite";
import { getDataDirectory, isKnownLocation, openPanoramaDatabase } from "./panorama-store.mjs";
import { requireUser } from "./auth";
import { checkSameOrigin, errorResponse, HttpError, readLimitedBody } from "./http";
import { coverageError, MAX_PANORAMA_BYTES, type Submission } from "../src/lib/uploads";

export function ownSubmissions(database: DatabaseSync, userId: number): Submission[] {
  return database.prepare(`SELECT id, location_id, status, uploaded_at, reviewed_at, haov, vaov, v_offset
    FROM panoramas WHERE uploaded_by = ? ORDER BY uploaded_at DESC, id DESC`).all(userId).map((row) => ({
      id: Number(row.id), locationId: String(row.location_id), status: row.status as Submission["status"],
      uploadedAt: String(row.uploaded_at), reviewedAt: row.reviewed_at === null ? null : String(row.reviewed_at),
      haov: Number(row.haov), vaov: Number(row.vaov), vOffset: Number(row.v_offset), imageUrl: `/api/panoramas/${row.id}/image`,
    }));
}

export async function saveSubmission(database: DatabaseSync, form: FormData, userId: number, directory = getDataDirectory()) {
  const locationId = form.get("locationId");
  if (typeof locationId !== "string" || !isKnownLocation(locationId)) throw new HttpError(400, "Select a location from the campus list.");
  const numbers = ["haov", "vaov", "vOffset"].map((key) => {
    const value = form.get(key);
    return typeof value === "string" && value.trim() ? Number(value) : NaN;
  });
  const [haov, vaov, vOffset] = numbers;
  const invalidCoverage = coverageError(haov, vaov, vOffset);
  if (invalidCoverage) throw new HttpError(400, invalidCoverage);
  const file = form.get("image");
  if (!(file instanceof File) || !file.size) throw new HttpError(400, "Choose a panorama image.");
  if (file.size > MAX_PANORAMA_BYTES) throw new HttpError(413, "Choose an image of 20 MB or less.");
  const bytes = Buffer.from(await file.arrayBuffer());
  let extension: string;
  try {
    const image = sharp(bytes, { limitInputPixels: 64_000_000, failOn: "error" });
    const metadata = await image.metadata();
    const formats: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };
    if (!metadata.format || !formats[metadata.format] || (metadata.pages ?? 1) > 1) throw new Error("Unsupported image");
    // Decode a small preview to detect corrupt data. Store the original bytes;
    // this is validation, not conversion or optimization of the uploaded file.
    await image.resize(16, 16, { fit: "inside", withoutEnlargement: true }).toBuffer();
    extension = formats[metadata.format];
  } catch {
    throw new HttpError(400, "Choose a readable, non-animated JPEG, PNG, or WebP image up to 64 megapixels.");
  }
  const relativePath = `uploads/${randomUUID()}.${extension}`;
  const absolutePath = path.join(directory, relativePath);
  await mkdir(path.join(directory, "uploads"), { recursive: true });
  await writeFile(absolutePath, bytes, { flag: "wx" });
  try {
    const row = database.prepare(`INSERT INTO panoramas
      (location_id, file_path, uploaded_by, status, haov, vaov, v_offset)
      VALUES (?, ?, ?, 'pending', ?, ?, ?) RETURNING id`).get(locationId, relativePath, userId, haov, vaov, vOffset);
    return ownSubmissions(database, userId).find((submission) => submission.id === Number(row!.id))!;
  } catch (error) {
    await unlink(absolutePath);
    throw error;
  }
}

export async function handleSubmissions(request: Request) {
  const database = openPanoramaDatabase();
  try {
    const user = requireUser(database, request);
    const headers = { "Cache-Control": "no-store" };
    if (request.method === "GET") return Response.json({ submissions: ownSubmissions(database, user.id) }, { headers });
    checkSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new HttpError(400, "Submit an image with its location and viewing settings.");
    const bytes = await readLimitedBody(request, MAX_PANORAMA_BYTES + 64 * 1024);
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: "POST", headers: { "Content-Type": request.headers.get("content-type")! }, body: new Uint8Array(bytes),
      }).formData();
    } catch { throw new HttpError(400, "Unable to read the upload. Please choose the file again."); }
    const submission = await saveSubmission(database, form, user.id);
    return Response.json({ submission }, { status: 201, headers });
  } catch (error) { return errorResponse(error); }
  finally { database.close(); }
}
