export type ApprovedPanorama = {
  id: number;
  locationId: string;
  imageUrl: string;
  haov: number;
  vaov: number;
  vOffset: number;
  isDemo: boolean;
};

export type PanoramaSource = Pick<ApprovedPanorama, "imageUrl" | "haov" | "vaov" | "vOffset">;

export function panoramaConfig(panorama: PanoramaSource, aspectRatio = 1) {
  // On portrait screens, the same horizontal zoom reveals much more vertically.
  // Keep the viewport inside a partial image's vertical coverage from first load.
  const verticalLimit = panorama.vaov >= 180 ? 120 :
    2 * Math.atan(Math.tan(panorama.vaov * Math.PI / 360) * aspectRatio) * 180 / Math.PI;
  const maxHfov = Math.min(120, panorama.haov, verticalLimit);
  return {
    type: "equirectangular",
    panorama: panorama.imageUrl,
    haov: panorama.haov,
    vaov: panorama.vaov,
    vOffset: panorama.vOffset,
    minYaw: -panorama.haov / 2,
    maxYaw: panorama.haov / 2,
    minPitch: panorama.vOffset - panorama.vaov / 2,
    maxPitch: panorama.vOffset + panorama.vaov / 2,
    pitch: panorama.vOffset,
    minHfov: Math.min(50, maxHfov),
    maxHfov,
    hfov: Math.min(100, maxHfov),
    avoidShowingBackground: true,
    autoLoad: true,
    showControls: true,
    compass: false,
    escapeHTML: true,
  };
}
