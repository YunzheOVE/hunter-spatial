import { describe, expect, it } from "vitest";
import { MAX_PANORAMA_BYTES, panoramaDimensionsError, panoramaFileError } from "./uploads";

describe("panorama file checks", () => {
  it("accepts supported images, including files with no browser MIME type", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(panoramaFileError({ name: "panorama", type, size: MAX_PANORAMA_BYTES })).toBeNull();
    }
    expect(panoramaFileError({ name: "panorama.JPG", type: "", size: 100 })).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(panoramaFileError({ name: "photo.gif", type: "image/gif", size: 100 })).toContain("JPEG, PNG, or WebP");
    expect(panoramaFileError({ name: "file.txt", type: "", size: 100 })).not.toBeNull();
    expect(panoramaFileError({ name: "photo.jpg", type: "image/jpeg", size: 0 })).toContain("empty");
    expect(panoramaFileError({ name: "photo.jpg", type: "image/jpeg", size: MAX_PANORAMA_BYTES + 1 })).toContain("20 MB");
  });
});

describe("panorama dimension checks", () => {
  it("accepts full-sphere 2:1 images within the pixel limit", () => {
    expect(panoramaDimensionsError(4000, 2000, true)).toBeNull();
    expect(panoramaDimensionsError(8000, 8000, false)).toBeNull();
  });

  it("rejects unreadable dimensions and images over 64 megapixels", () => {
    expect(panoramaDimensionsError(0, 1000, false)).toContain("Unable to read");
    expect(panoramaDimensionsError(16000, 8000, true)).toContain("64 megapixels");
  });

  it("requires 2:1 only for a full sphere and can recheck after coverage changes", () => {
    expect(panoramaDimensionsError(4000, 1000, true)).toContain("2:1");
    expect(panoramaDimensionsError(4000, 1000, false)).toBeNull();
    expect(panoramaDimensionsError(4000, 1999, true)).toContain("2:1");
  });
});
