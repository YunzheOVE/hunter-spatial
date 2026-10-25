import { readFileSync } from "node:fs";
import path from "node:path";
import { findVisibleImage, openPanoramaDatabase, resolveImagePath } from "../../../../../../server/panorama-store.mjs";
import { sessionUser } from "../../../../../../server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return Response.json({ error: "Image not found." }, { status: 404 });
  }
  const database = openPanoramaDatabase();
  let filePath: string | null;
  try {
    const user = sessionUser(database, _request);
    filePath = findVisibleImage(database, Number(id), user?.id ?? null, user?.role === "reviewer");
  } finally {
    database.close();
  }
  if (!filePath) return Response.json({ error: "Image not found." }, { status: 404 });
  try {
    const resolved = resolveImagePath(filePath);
    const contentType = imageTypes[path.extname(resolved).toLowerCase()];
    if (!contentType) return Response.json({ error: "Image not found." }, { status: 404 });
    return new Response(new Uint8Array(readFileSync(resolved)), {
      headers: { "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Image not found." }, { status: 404 });
  }
}
