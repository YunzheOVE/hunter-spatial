export type SessionUser = { id: number; name: string; email: string; role: "uploader" | "reviewer" };

export type Submission = {
  id: number;
  locationId: string;
  status: "pending" | "approved" | "rejected";
  uploadedAt: string;
  reviewedAt: string | null;
  imageUrl: string;
  haov: number;
  vaov: number;
  vOffset: number;
};

export const MAX_PANORAMA_BYTES = 20 * 1024 * 1024;

export function coverageError(haov: number, vaov: number, vOffset: number): string | null {
  if (![haov, vaov, vOffset].every(Number.isFinite) || haov < 1 || haov > 360 || vaov < 1 || vaov > 180 || Math.abs(vOffset) + vaov / 2 > 90) {
    return "Choose horizontal coverage from 1–360°, vertical coverage from 1–180°, and an offset that keeps the image between −90° and 90°.";
  }
  return null;
}
