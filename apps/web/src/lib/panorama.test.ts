import { describe, expect, it } from "vitest";
import { panoramaConfig, type ApprovedPanorama } from "./panorama";

const example: ApprovedPanorama = {
  id: 1, locationId: "N304", imageUrl: "/api/panoramas/1/image",
  haov: 270, vaov: 90, vOffset: 0, isDemo: true,
};

describe("panorama coverage", () => {
  it("restricts navigation to the partial image coverage", () => {
    expect(panoramaConfig(example)).toMatchObject({
      panorama: example.imageUrl, haov: 270, vaov: 90,
      minYaw: -135, maxYaw: 135, minPitch: -45, maxPitch: 45,
      avoidShowingBackground: true,
    });
  });

  it("supports full spherical coverage and shifted partial images", () => {
    expect(panoramaConfig({ ...example, haov: 360, vaov: 180 })).toMatchObject({
      minYaw: -180, maxYaw: 180, minPitch: -90, maxPitch: 90,
    });
    expect(panoramaConfig({ ...example, vOffset: 10 })).toMatchObject({
      minPitch: -35, maxPitch: 55, pitch: 10,
    });
  });

  it("limits initial and maximum zoom-out to vertical coverage on a tall screen", () => {
    const aspectRatio = 366 / 630;
    const config = panoramaConfig(example, aspectRatio);
    const verticalFov = 2 * Math.atan(Math.tan(config.hfov * Math.PI / 360) / aspectRatio) * 180 / Math.PI;
    expect(verticalFov).toBeLessThanOrEqual(example.vaov + 0.000001);
    expect(config.hfov).toBeLessThan(100);
    expect(config.maxHfov).toBe(config.hfov);
    expect(config.minHfov).toBeLessThanOrEqual(config.maxHfov);
  });
});
