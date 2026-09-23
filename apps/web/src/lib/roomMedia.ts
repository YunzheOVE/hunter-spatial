export type RoomMedia = {
  photo?: { src: string; alt: string };
  panorama?: { preview: string; viewerUrl: string };
  nearbyHallway?: { name: string; viewerUrl: string };
};

// Key by the canonical room ID in the routing graph. Only publish real campus
// imagery. viewerUrl points to a hosted interactive tour, not a flat image.
export const ROOM_MEDIA: Record<string, RoomMedia> = {};
