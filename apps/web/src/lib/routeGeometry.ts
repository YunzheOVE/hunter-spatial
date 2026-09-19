import type { RouteLeg, RouteResult, RouteTransition } from "./pathfinding";

export const STOREY_HEIGHT = 3.5;

export type RouteRibbonFeature = {
  type: "Feature";
  geometry: {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
  properties: {
    id: string;
    building: string;
    level: number;
    base: number;
    height: number;
    distanceMeters: number;
    color?: string;
  };
};

export type RouteMarkerFeature = {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    id: string;
    kind: "start" | "destination" | "stairs" | "elevator" | "escalator" | "bridge" | "connector";
    label: string;
    building: string;
    level: number;
    base: number;
    description: string;
  };
};

export type RouteGeoJSON = {
  ribbons: {
    type: "FeatureCollection";
    features: RouteRibbonFeature[];
  };
  markers: {
    type: "FeatureCollection";
    features: RouteMarkerFeature[];
  };
};

/**
 * Generate 3D ribbon polygons around a line coordinate sequence with width in meters.
 */
function lineToRibbonQuads(coords: [number, number][], ribbonWidthMeters: number = 0.8): number[][][][] {
  if (coords.length < 2) return [];

  const halfWidthM = ribbonWidthMeters / 2;
  const meterToDeg = 1 / 111320;
  const quads: number[][][][] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];

    const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
    const cosLat = Math.max(0.01, Math.cos(midLat));

    const dx = (lon2 - lon1) * cosLat;
    const dy = lat2 - lat1;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-9) continue;

    const offsetLat = (-dx / len) * halfWidthM * meterToDeg;
    const offsetLon = ((dy / len) * halfWidthM * meterToDeg) / cosLat;

    quads.push([
      [
        [lon1 + offsetLon, lat1 + offsetLat],
        [lon1 - offsetLon, lat1 - offsetLat],
        [lon2 - offsetLon, lat2 - offsetLat],
        [lon2 + offsetLon, lat2 + offsetLat],
        [lon1 + offsetLon, lat1 + offsetLat],
      ],
    ]);
  }

  return quads;
}

/**
 * Generate a 3D polygonal cylinder ring around a point with a given radius in meters.
 */
function circleToExtrusionPolygon(
  center: [number, number],
  radiusMeters: number = 0.9,
  sides: number = 12
): number[][][][] {
  const [lon, lat] = center;
  const meterToDeg = 1 / 111320;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const ring: number[][] = [];
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * 2 * Math.PI;
    const dx = (Math.cos(angle) * radiusMeters * meterToDeg) / cosLat;
    const dy = Math.sin(angle) * radiusMeters * meterToDeg;
    ring.push([lon + dx, lat + dy]);
  }
  return [[ring]];
}

/**
 * Converts a RouteResult into MapLibre-ready GeoJSON for 3D ribbons and markers.
 */
export function routeToGeoJSON(route: RouteResult | null | undefined): RouteGeoJSON {
  if (!route || route.legs.length === 0) {
    return {
      ribbons: { type: "FeatureCollection", features: [] },
      markers: { type: "FeatureCollection", features: [] },
    };
  }

  const ribbonFeatures: RouteRibbonFeature[] = [];
  const markerFeatures: RouteMarkerFeature[] = [];

  // 1. Build 3D ribbon polygons for each leg
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    if (leg.coordinates.length < 2) continue;

    const quads = lineToRibbonQuads(leg.coordinates, 0.85);
    if (quads.length === 0) continue;

    const floorBase = Math.max(0, (leg.level - 1) * STOREY_HEIGHT);

    ribbonFeatures.push({
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: quads,
      },
      properties: {
        id: `leg-${i}-${leg.building}-L${leg.level}`,
        building: leg.building,
        level: leg.level,
        base: floorBase + 0.08,
        height: floorBase + 0.2,
        distanceMeters: leg.distanceMeters,
        color: "#8b5cf6",
      },
    });
  }

  // 2. Build start and destination markers & 3D pedestals
  const firstLeg = route.legs[0];
  const lastLeg = route.legs[route.legs.length - 1];

  const startCoord = firstLeg.coordinates[0];
  const startBase = Math.max(0, (firstLeg.level - 1) * STOREY_HEIGHT);

  // 3D Start Pedestal (green solid cylinder standing on floor plate)
  ribbonFeatures.push({
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: circleToExtrusionPolygon(startCoord, 0.9),
    },
    properties: {
      id: `pin-start-${route.fromRoom}`,
      building: firstLeg.building,
      level: firstLeg.level,
      base: startBase + 0.08,
      height: startBase + 0.9,
      distanceMeters: 0,
      color: "#10b981",
    },
  });

  markerFeatures.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: startCoord },
    properties: {
      id: `marker-start-${route.fromRoom}`,
      kind: "start",
      label: route.fromRoom,
      building: firstLeg.building,
      level: firstLeg.level,
      base: startBase,
      description: `Start: ${route.fromRoom} (${firstLeg.building} Level ${firstLeg.level})`,
    },
  });

  const destCoord = lastLeg.coordinates[lastLeg.coordinates.length - 1];
  const destBase = Math.max(0, (lastLeg.level - 1) * STOREY_HEIGHT);

  // 3D Destination Pedestal (amber solid cylinder standing on floor plate)
  ribbonFeatures.push({
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: circleToExtrusionPolygon(destCoord, 0.9),
    },
    properties: {
      id: `pin-dest-${route.toRoom}`,
      building: lastLeg.building,
      level: lastLeg.level,
      base: destBase + 0.08,
      height: destBase + 0.9,
      distanceMeters: 0,
      color: "#f59e0b",
    },
  });

  markerFeatures.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: destCoord },
    properties: {
      id: `marker-dest-${route.toRoom}`,
      kind: "destination",
      label: route.toRoom,
      building: lastLeg.building,
      level: lastLeg.level,
      base: destBase,
      description: `Destination: ${route.toRoom} (${lastLeg.building} Level ${lastLeg.level})`,
    },
  });

  // 3. Build transition markers (elevators, stairs, skybridges)
  for (let i = 0; i < route.transitions.length; i++) {
    const tr = route.transitions[i];
    const trBase = Math.max(0, (tr.fromLevel - 1) * STOREY_HEIGHT);
    let label = "Transit";
    if (tr.type === "bridge") {
      label = `Skybridge → ${tr.toBuilding}`;
    } else if (tr.type === "elevator") {
      label = `Elevator → L${tr.toLevel}`;
    } else if (tr.type === "stairs") {
      label = `Stairs → L${tr.toLevel}`;
    }

    markerFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: tr.location },
      properties: {
        id: `marker-tr-${i}-${tr.type}`,
        kind: tr.type,
        label,
        building: tr.fromBuilding,
        level: tr.fromLevel,
        base: trBase + 0.25,
        description: tr.description,
      },
    });
  }

  return {
    ribbons: { type: "FeatureCollection", features: ribbonFeatures },
    markers: { type: "FeatureCollection", features: markerFeatures },
  };
}
