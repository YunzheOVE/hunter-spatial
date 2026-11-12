import { openPanoramaDatabase } from "./panorama-store.mjs";
import { requireUser } from "./auth";
import { checkSameOrigin, errorResponse, HttpError, readLimitedBody } from "./http";

export async function handleReviews(request: Request, id?: string) {
  const database = openPanoramaDatabase();
  try {
    const user = requireUser(database, request);
    if (user.role !== "reviewer") throw new HttpError(403, "Reviewer access required.");
    const headers = { "Cache-Control": "no-store" };
    if (request.method === "GET") {
      const submissions = database.prepare(`SELECT p.id, p.location_id, p.uploaded_at, p.haov, p.vaov, p.v_offset, u.name
        FROM panoramas p JOIN users u ON u.id = p.uploaded_by
        WHERE p.status = 'pending' ORDER BY p.uploaded_at, p.id`).all().map((row) => ({
        id: Number(row.id), locationId: String(row.location_id), uploadedAt: String(row.uploaded_at),
        uploaderName: String(row.name), imageUrl: `/api/panoramas/${row.id}/image`,
        haov: Number(row.haov), vaov: Number(row.vaov), vOffset: Number(row.v_offset),
      }));
      return Response.json({ submissions }, { headers });
    }
    checkSameOrigin(request);
    if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new HttpError(400, "Invalid submission ID.");
    let body;
    const bytes = await readLimitedBody(request, 1024);
    try { body = JSON.parse(bytes.toString()); } catch { throw new HttpError(400, "Choose approve or reject."); }
    if (body?.decision !== "approved" && body?.decision !== "rejected") throw new HttpError(400, "Choose approve or reject.");
    const updated = database.prepare(`UPDATE panoramas SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending' RETURNING id`).get(body.decision, user.id, Number(id));
    if (!updated) {
      if (!database.prepare("SELECT id FROM panoramas WHERE id = ?").get(Number(id))) throw new HttpError(404, "Submission not found.");
      throw new HttpError(409, "This submission has already been reviewed. The queue has been refreshed.");
    }
    return Response.json({ id: Number(id), status: body.decision }, { headers });
  } catch (error) { return errorResponse(error); }
  finally { database.close(); }
}
