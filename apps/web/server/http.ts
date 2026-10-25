export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function checkSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next may normalize request.url to localhost when the browser used 127.0.0.1
  // or a LAN address. The incoming Host header preserves the browser's host.
  const host = request.headers.get("host") ?? url.host;
  let matches = true;
  if (origin) {
    try { const source = new URL(origin); matches = source.host === host && source.protocol === url.protocol; }
    catch { matches = false; }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site" || !matches) {
    throw new HttpError(403, "Please submit from Hunter Spatial.");
  }
}

export async function readLimitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) {
    throw new HttpError(413, "The request is too large.");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new HttpError(413, "The request is too large.");
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks);
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  console.error("Panorama request failed:", error);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
