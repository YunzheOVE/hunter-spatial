import { findApprovedPanorama, isKnownLocation, openPanoramaDatabase } from "../../../../server/panorama-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const locationId = new URL(request.url).searchParams.get("locationId");
  if (!locationId?.trim()) return Response.json({ error: "A locationId is required." }, { status: 400 });
  if (!isKnownLocation(locationId)) return Response.json({ error: "Unknown campus location." }, { status: 404 });
  const database = openPanoramaDatabase();
  try {
    return Response.json(findApprovedPanorama(database, locationId), { headers: { "Cache-Control": "no-store" } });
  } finally {
    database.close();
  }
}
