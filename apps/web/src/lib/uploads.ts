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
export const MAX_PANORAMA_PIXELS = 64_000_000;

export function panoramaFileError(file: Pick<File, "name" | "type" | "size">): string | null {
  const supported = file.type ? ["image/jpeg", "image/png", "image/webp"].includes(file.type) : /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!supported) return "Choose a JPEG, PNG, or WebP image.";
  if (!file.size) return "The image file is empty. Choose another image.";
  if (file.size > MAX_PANORAMA_BYTES) return "Choose an image of 20 MB or less.";
  return null;
}

export function panoramaDimensionsError(width: number, height: number, fullSphere: boolean): string | null {
  if (width <= 0 || height <= 0) return "Unable to read this image. Choose another JPEG, PNG, or WebP.";
  if (width * height > MAX_PANORAMA_PIXELS) return "Choose an image of 64 megapixels or less.";
  if (fullSphere && width !== height * 2) return "Full-sphere images must be 2:1 (for example, 4000 × 2000). Choose a 2:1 image, or select Partial panorama if it covers less than a full sphere.";
  return null;
}

export function coverageError(haov: number, vaov: number, vOffset: number): string | null {
  if (![haov, vaov, vOffset].every(Number.isFinite) || haov < 1 || haov > 360 || vaov < 1 || vaov > 180 || Math.abs(vOffset) + vaov / 2 > 90) {
    return "Choose horizontal coverage from 1–360°, vertical coverage from 1–180°, and an offset that keeps the image between −90° and 90°.";
  }
  return null;
}
