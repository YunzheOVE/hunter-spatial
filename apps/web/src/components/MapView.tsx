"use client";

import { LngLat, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import type { WindowFeature } from "@/lib/mapScene";
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, PaddingOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  campusBuildingsAtLevel,
  campusPodiumLevels,
  CAMPUS_TOP_FLOORS,
  type CampusBuildingId,
  STOREY_HEIGHT,
} from "@/lib/campusLevels";
import { edgeSeconds, type RouteResult } from "@/lib/pathfinding";
import { routeArrows, routeToGeoJSON } from "@/lib/routeGeometry";
import {
  BASEMAP_COLOR_PROPERTIES,
  basemapPaint,
  hunterWindows,
  LIT_SHARE,
  sceneStyle,
  seasonForMonth,
  timeOfDayForHour,
  type MassFeature,
  type Season,
  type TimeOfDay,
  type Weather,
} from "@/lib/mapScene";
import { SceneControl } from "./SceneControl";
import { WeatherLayer } from "./WeatherLayer";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type Props = {
  buildingId: CampusBuildingId | null;
  floor: number | null;
  panelOpen: boolean;
  selectedRoom: string | null;
  onSelectRoom: (roomId: string) => void;
  activeRoute?: RouteResult | null;
  activeLegIndex?: number | null;
  directionMode?: boolean;
  pickedBuilding?: CampusBuildingId | null;
  onPickBuilding?: (id: CampusBuildingId) => void;
};

type FloorProps = {
  id: string;
  roomId: string;
  kind: string;
  scope: string;
  building: string;
  level: number | null;
  base: number;
  height: number;
};
type FloorFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: FloorProps;
};

function bboxOfMany(features: FloorFeature[]): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === "number") {
      minX = Math.min(minX, value[0] as number);
      minY = Math.min(minY, value[1] as number);
      maxX = Math.max(maxX, value[0] as number);
      maxY = Math.max(maxY, value[1] as number);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry.coordinates);
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

function isCampusBuildingId(value: string): value is CampusBuildingId {
  return value in CAMPUS_TOP_FLOORS;
}

function indoorFilter(
  kind: string,
  floor: number | null,
  buildingId: CampusBuildingId | null,
): FilterSpecification {
  if (floor === null) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  const buildingLevels = campusBuildingsAtLevel(buildingId, floor).map((building) => [
    "all",
    ["==", ["get", "building"], building],
    ["==", ["get", "level"], floor],
  ]);
  if (!buildingLevels.length) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  return [
    "all",
    ["==", ["get", "kind"], kind],
    ["==", ["get", "scope"], "indoor"],
    ["any", ...buildingLevels],
  ] as unknown as FilterSpecification;
}

function stackedPodiumFilter(
  floor: number | null,
  buildingId: CampusBuildingId | null,
): FilterSpecification {
  if (floor === null) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  const buildingLevels = campusPodiumLevels(buildingId, floor).map(([building, topLevel]) => [
    "all",
    ["==", ["get", "building"], building],
    ["<=", ["get", "level"], topLevel],
  ]);
  if (!buildingLevels.length) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  return [
    "all",
    ["==", ["get", "kind"], "floor"],
    ["==", ["get", "scope"], "indoor"],
    [">=", ["get", "level"], 1],
    ["any", ...buildingLevels],
  ] as unknown as FilterSpecification;
}

function isVisibleFloor(
  feature: FloorFeature,
  floor: number,
  buildingId: CampusBuildingId | null,
): boolean {
  const { building, kind, level } = feature.properties;
  return kind === "floor"
    && isCampusBuildingId(building)
    && level === floor
    && campusBuildingsAtLevel(buildingId, floor).includes(building);
}

function hasWebGL2(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2"));
}

function bboxOfCoords(coords: [number, number][]): [number, number, number, number] | null {
  if (coords.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

// Keep camera targets clear of the overlay: left panel on desktop, bottom sheet on phones, floor picker on the right.
function cameraPadding(map: MapLibreMap, panelOpen: boolean) {
  const { clientWidth, clientHeight } = map.getContainer();
  if (clientWidth < 768) return { top: 90, right: 72, bottom: Math.round(clientHeight * 0.45), left: 24 };
  return panelOpen
    ? { top: 90, right: 96, bottom: 90, left: 440 }
    : { top: 150, right: 96, bottom: 120, left: 80 };
}

const CAMERA_BEARING = -20;
const EARTH_CIRCUMFERENCE_M = 40075016.686;
const METERS_PER_DEGREE = 111320;

function levelHeight(level: number) {
  return Math.max(0, (level - 1) * STOREY_HEIGHT);
}

// fitBounds frames the ground, but upper floors sit up to ~65 m above it. For a camera tilted by `pitch`, a point
// h metres up lies on the view axis when the ground centre moves h·tan(pitch) forward, and it is h/cos(pitch)
// closer to the camera, so zoom out by that ratio to keep the intended framing.
function fitElevated(
  map: MapLibreMap,
  box: [number, number, number, number],
  heightMeters: number,
  pitch: number,
  padding: PaddingOptions,
  maxZoom: number,
) {
  const target = map.cameraForBounds(box, { padding, pitch, bearing: CAMERA_BEARING, maxZoom });
  if (!target?.center || target.zoom === undefined) return;
  const center = LngLat.convert(target.center);
  const tilt = (pitch * Math.PI) / 180;
  const heading = (CAMERA_BEARING * Math.PI) / 180;
  const latitude = (center.lat * Math.PI) / 180;
  const metersPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(latitude)) / (512 * 2 ** target.zoom);
  const cameraMeters = (0.5 / Math.tan((map.getVerticalFieldOfView() * Math.PI) / 360)) * map.getCanvas().clientHeight * metersPerPixel;
  const forward = heightMeters * Math.tan(tilt);
  map.easeTo({
    center: [
      center.lng + (forward * Math.sin(heading)) / (METERS_PER_DEGREE * Math.cos(latitude)),
      center.lat + (forward * Math.cos(heading)) / METERS_PER_DEGREE,
    ],
    zoom: target.zoom - Math.log2(1 + heightMeters / (Math.cos(tilt) * cameraMeters)),
    pitch,
    bearing: CAMERA_BEARING,
    duration: 750,
  });
}

function fitRoom(map: MapLibreMap, data: FloorFeature[], roomId: string, level: number | null, panelOpen: boolean) {
  const room = data.filter((item) => item.properties.kind === "room" && item.properties.roomId === roomId && item.properties.level === level);
  const box = bboxOfMany(room);
  if (!box) return;
  fitElevated(map, box, room[0].properties.base ?? 0, 52, cameraPadding(map, panelOpen), 19.2);
}

function fitFeatures(
  map: MapLibreMap,
  data: FloorFeature[],
  floor: number | null,
  buildingId: CampusBuildingId | null,
  panelOpen: boolean,
  activeRoute?: RouteResult | null,
  activeLegIndex?: number | null,
  directionMode: boolean = false,
) {
  const indoor = floor != null;
  const effectiveBuildingId = directionMode ? null : buildingId;

  let targetBox: [number, number, number, number] | null = null;
  let isStepFocus = false;

  if (activeRoute && activeRoute.legs.length > 0) {
    // 1. Prioritize the currently active leg if activeLegIndex is specified
    const currentLeg =
      activeLegIndex != null && activeRoute.legs[activeLegIndex]
        ? activeRoute.legs[activeLegIndex]
        : null;

    if (currentLeg && currentLeg.coordinates.length > 0) {
      isStepFocus = true;
      const legBbox = bboxOfCoords(currentLeg.coordinates);
      if (legBbox) {
        const [minX, minY, maxX, maxY] = legBbox;
        // Pad by ~25m so camera frames the route segment closely with clear corridor context
        const minSpanLon = 0.00032; // ~25m
        const minSpanLat = 0.00022; // ~25m
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const halfSpanX = Math.max((maxX - minX) / 2 + 0.0001, minSpanLon);
        const halfSpanY = Math.max((maxY - minY) / 2 + 0.00008, minSpanLat);
        targetBox = [midX - halfSpanX, midY - halfSpanY, midX + halfSpanX, midY + halfSpanY];
      }
    } else {
      const floorLegs = activeRoute.legs.filter((l) => l.level === floor);
      if (floorLegs.length > 0) {
        const floorCoords = floorLegs.flatMap((l) => l.coordinates);
        if (floorCoords.length > 0) {
          targetBox = bboxOfCoords(floorCoords);
        }
      }
    }
  }

  const features =
    !indoor
      ? data.filter((item) => item.properties.kind === "mass")
      : effectiveBuildingId == null
        ? data.filter((item) => item.properties.kind === "floor")
        : data.filter((item) => isVisibleFloor(item, floor, effectiveBuildingId));
  const box = targetBox ?? bboxOfMany(features.length ? features : data);
  if (!box) return;
  const padding = cameraPadding(map, panelOpen);
  const pitch = indoor ? 52 : 48;
  const legLevel = activeLegIndex != null ? activeRoute?.legs[activeLegIndex]?.level : undefined;
  const elevation = indoor ? levelHeight(legLevel ?? floor) : 0;

  const targetMaxZoom = isStepFocus
    ? 19.6 // Zoom closely on the active route corridor so users see turns and doors clearly
    : activeRoute
      ? 18.5
      : indoor
        ? 18.2
        : 16.7;

  fitElevated(map, box, elevation, pitch, padding, targetMaxZoom);
}

// Icon paths on a 24px grid (Lucide-style strokes; restroom figures are filled pictograms).
const BADGE_ICONS: Record<string, [color: string, icon: string]> = {
  "badge-classroom": ["#1e293b", '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>'],
  "badge-lecture": ["#7c3aed", '<path d="M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5"/>'],
  "badge-study": ["#d97706", '<path d="M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5"/>'],
  "badge-office": ["#475569", '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'],
  "badge-food": ["#ea580c", '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2"/>'],
  "badge-lounge": ["#b45309", '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0zM4 18v2M20 18v2"/>'],
  "badge-entrance": ["#0f766e", '<path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56z"/>'],
  "badge-entrance-accessible": ["#1d4ed8", '<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1M5 8l3-3 5.5 3-2.36 3.5M4.24 14.5a5 5 0 0 0 6.88 6M13.76 17.5a5 5 0 0 0-6.88-6"/>'],
  "badge-subway": ["#1f2937", '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l-2-4M15 21l2-4M9 14h.01M15 14h.01"/>'],
  "badge-bus": ["#0e7490", '<path d="M6 17V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12M6 11h12M8 21v-4M16 21v-4M6 17h12M9 14h.01M15 14h.01"/>'],
  "badge-stairs": ["#2563eb", '<path d="M3 21h5v-5h5v-5h5V6h3"/>'],
  "badge-elevator": ["#2563eb", '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="m9 9 3-3 3 3M9 15l3 3 3-3"/>'],
  "badge-restroom-men": ["#2563eb", '<g fill="#fff" stroke="none"><circle cx="12" cy="4.5" r="2.3"/><path d="M9.5 8.5h5a1.5 1.5 0 0 1 1.5 1.5v5.5h-2v6.5h-4v-6.5H8V10a1.5 1.5 0 0 1 1.5-1.5z"/></g>'],
  "badge-restroom-women": ["#ec4899", '<g fill="#fff" stroke="none"><circle cx="12" cy="4.5" r="2.3"/><path d="M10 8.5h4l3 8h-3v5.5h-4v-5.5H7z"/></g>'],
  "badge-restroom": ["#15803d", '<g fill="#fff" stroke="none"><circle cx="7.5" cy="4.5" r="2"/><path d="M5.5 8h4a1 1 0 0 1 1 1v5h-1.5v7h-3v-7H4.5V9a1 1 0 0 1 1-1z"/><circle cx="16.5" cy="4.5" r="2"/><path d="M15 8h3l2.5 7H18v6h-3v-6h-2.5z"/></g>'],
};

function badgeSvg(color: string, icon: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-opacity=".3"/></filter></defs><circle cx="32" cy="32" r="27" fill="#fff" filter="url(#s)"/><circle cx="32" cy="32" r="24" fill="${color}"/><g transform="translate(18 18) scale(1.1667)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</g></svg>`;
}

// Classrooms show as small dots until zoomed in, so amenities stand out.
const CLASSROOM_DOT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="11" fill="#fff"/><circle cx="32" cy="32" r="7.5" fill="#1e293b"/></svg>';

async function addSvgImage(map: MapLibreMap, id: string, svg: string) {
  if (map.hasImage(id)) return;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
}

async function registerCustomBadges(map: MapLibreMap) {
  await Promise.all([
    ...Object.entries(BADGE_ICONS).map(([id, [color, icon]]) => addSvgImage(map, id, badgeSvg(color, icon))),
    addSvgImage(map, "dot-classroom", CLASSROOM_DOT_SVG),
  ]);
}

/** Badge per marker; classroom-category rooms named like lounges or cafés get the food & lounge icons. */
function markerIcon(classroomIcon: string): ExpressionSpecification {
  const name = ["downcase", ["coalesce", ["get", "name"], ""]] as ExpressionSpecification;
  return [
    "case",
    ["==", ["get", "category"], "classroom"],
    ["case", ["in", "lounge", name], "badge-lounge", ["any", ["in", "caf", name], ["in", "dining", name]], "badge-food", classroomIcon],
    ["coalesce", ["get", "iconBadge"], "badge-classroom"],
  ];
}

async function registerRouteMarkerIcons(map: MapLibreMap) {
  for (const [id, url] of [
    ["route-start", "/icons/route-start.svg"],
    ["route-destination", "/icons/route-destination.svg"],
  ] as const) {
    if (map.hasImage(id)) continue;
    const image = new Image();
    image.src = url;
    await image.decode();
    map.addImage(id, image, { pixelRatio: 2 });
  }
}

function roomColor(selectedRoom: string | null): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "roomId"], selectedRoom ?? ""],
    "#10b981",
    ["coalesce", ["get", "color"], "#ffffff"],
  ];
}

const HUNTER_FACADE = "#7446ad";

// Basemap (OpenMapTiles) copies of Hunter's own buildings; excluded so they don't z-fight with the campus masses.
// shortcut: ids found by matching basemap footprints to hunter-floors.geojson masses; recheck if the basemap or campus data changes.
const BASEMAP_HUNTER_IDS = [1081114240, 2653453830, 2668640830, 2668865400, 36068380];

// Level matters: some basement rooms share a room id with an upper floor (WB406 is stored as W406 on level -4).
function selectedRoomFilter(roomId: string | null, level: number | null): FilterSpecification {
  return ["all", ["==", ["get", "kind"], "room"], ["==", ["get", "roomId"], roomId ?? "__none__"], ["==", ["get", "level"], level ?? 1]];
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const NO_FEATURE: FilterSpecification = ["==", ["get", "id"], ""];

type BasemapLayer = { id: string; type: string };

/** Recolors the basemap for the scene, remembering the original colors so clear daylight can restore them. */
function paintBasemap(map: MapLibreMap, layers: BasemapLayer[], time: TimeOfDay, weather: Weather, season: Season, originals: Map<string, unknown>) {
  for (const { id, type } of layers) {
    if (!map.getLayer(id)) continue;
    const colors = new Map(basemapPaint(id, type, time, weather, season));
    for (const property of BASEMAP_COLOR_PROPERTIES[type] ?? []) {
      const key = `${id}|${property}`;
      const color = colors.get(property);
      if (color && !originals.has(key)) originals.set(key, map.getPaintProperty(id, property));
      if (color) map.setPaintProperty(id, property, color);
      else if (originals.has(key)) map.setPaintProperty(id, property, originals.get(key) as string | ExpressionSpecification | undefined);
    }
  }
}

const BUILDING_LIFT_M = 6;
const INTRO_KEY = "hunter-map-intro-seen";

function liftFor(building: string | null, lift: number): ExpressionSpecification {
  return ["case", ["==", ["get", "building"], building ?? ""], lift, 0];
}

function hideBasemapExtrusions(map: MapLibreMap) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === "fill-extrusion") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

function setMode(
  map: MapLibreMap,
  floor: number | null,
  buildingId: CampusBuildingId | null,
  directionMode: boolean = false,
) {
  const indoor = floor != null;
  for (const id of [
    "stacked-podiums",
    "floor-plate",
    "hallways",
    "rooms",
    "room-outlines",
    "walls",
    "campus-room-labels",
    "route-ribbons",
    "route-arrows",
    "route-markers-label",
    "room-hover",
    "room-selected-glow",
    "room-selected-beam",
    "room-selected-label",
  ]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", indoor ? "visible" : "none");
    }
  }
  // Neighbors would hide floor plates indoors, so the city context is outdoor-only.
  for (const id of ["campus-flat", "building-labels", "campus-entrances", "hunter-mass", "hunter-roofs", "context-buildings", "transit-stops", "transit-link"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", indoor ? "none" : "visible");
  }

  // Skybridges connect campus buildings at Level 3.
  // - Outdoors (floor == null): 3D purple exterior mass (height 9.6m, color #5b238a)
  // - Level 3 indoors (floor === 3): flat walkway plate (height 7.06m, color #d8dde4) so route ribbons on top are completely unobstructed
  // - Other indoor floors (floor !== 3): hidden completely so they do not hover in mid-air or obstruct other floors
  if (map.getLayer("hunter-bridges")) {
    const isLevel3 = floor === 3;
    const showBridges = !indoor || isLevel3;
    map.setLayoutProperty("hunter-bridges", "visibility", showBridges ? "visible" : "none");

    if (showBridges) {
      if (!indoor) {
        map.setPaintProperty("hunter-bridges", "fill-extrusion-base", 7.0);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-height", 9.6);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-color", HUNTER_FACADE);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-opacity", 1.0);
      } else {
        map.setPaintProperty("hunter-bridges", "fill-extrusion-base", 7.0);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-height", 7.06);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-color", "#d8dde4");
        map.setPaintProperty("hunter-bridges", "fill-extrusion-opacity", 1.0);
      }
    }
  }

  if (!indoor) {
    map.setFilter("hunter-mass", ["==", ["get", "kind"], "mass"]);
    map.setPaintProperty("hunter-mass", "fill-extrusion-color", HUNTER_FACADE);
    if (map.getLayer("campus-room-labels")) map.setFilter("campus-room-labels", ["==", ["get", "id"], ""]);
    if (map.getLayer("route-ribbons")) map.setFilter("route-ribbons", ["==", ["get", "id"], ""]);
    if (map.getLayer("route-arrows")) map.setFilter("route-arrows", ["==", ["get", "id"], ""]);
    if (map.getLayer("route-markers-label")) map.setFilter("route-markers-label", ["==", ["get", "id"], ""]);
    return;
  }

  // In direction mode (or when a route is active), ALWAYS keep all buildings visible
  const effectiveBuildingId = directionMode ? null : buildingId;

  map.setFilter("stacked-podiums", stackedPodiumFilter(floor, effectiveBuildingId));
  map.setFilter("floor-plate", indoorFilter("floor", floor, effectiveBuildingId));
  map.setFilter("hallways", indoorFilter("hallway", floor, effectiveBuildingId));
  map.setFilter("rooms", indoorFilter("room", floor, effectiveBuildingId));
  if (map.getLayer("room-outlines")) {
    map.setFilter("room-outlines", indoorFilter("room-outline", floor, effectiveBuildingId));
  }
  map.setFilter("walls", indoorFilter("wall", floor, effectiveBuildingId));

  const markerFilter = (
    effectiveBuildingId == null
      ? ["==", ["get", "level"], floor]
      : ["all", ["==", ["get", "level"], floor], ["==", ["get", "building"], effectiveBuildingId]]
  ) as FilterSpecification;

  if (map.getLayer("campus-room-labels")) map.setFilter("campus-room-labels", markerFilter);

  const routeFilter: FilterSpecification = [
    "any",
    ["==", ["get", "level"], floor],
    ["==", ["get", "toLevel"], floor],
  ] as unknown as FilterSpecification;

  if (map.getLayer("route-ribbons")) map.setFilter("route-ribbons", routeFilter);
  if (map.getLayer("route-arrows")) map.setFilter("route-arrows", routeFilter);
  if (map.getLayer("route-markers-label")) map.setFilter("route-markers-label", routeFilter);
}

export function MapView({
  buildingId,
  floor,
  panelOpen,
  selectedRoom,
  onSelectRoom,
  activeRoute,
  activeLegIndex,
  directionMode = false,
  pickedBuilding = null,
  onPickBuilding,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRoomRef = useRef(onSelectRoom);
  const floorRef = useRef(floor);
  const panelOpenRef = useRef(panelOpen);
  const buildingIdRef = useRef(buildingId);
  const activeRouteRef = useRef(activeRoute);
  const activeLegIndexRef = useRef(activeLegIndex);
  const directionModeRef = useRef(directionMode);
  const dataRef = useRef<FloorFeature[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const windowsRef = useRef<WindowFeature[]>([]);
  const basemapLayersRef = useRef<BasemapLayer[]>([]);
  const basemapOriginalsRef = useRef(new Map<string, unknown>());
  const [time, setTime] = useState<TimeOfDay>(() => timeOfDayForHour(new Date().getHours()));
  const [weather, setWeather] = useState<Weather>("clear");
  const [season, setSeason] = useState<Season>(() => seasonForMonth(new Date().getMonth()));
  const outdoor = floor == null;
  // Indoors stays in clear daylight so floor plans keep their colors.
  const scene = useMemo(() => sceneStyle(outdoor ? time : "day", outdoor ? weather : "clear"), [outdoor, time, weather]);
  const shownFloorRef = useRef(floor);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading campus map…");
  onSelectRoomRef.current = onSelectRoom;
  const onPickBuildingRef = useRef(onPickBuilding);
  onPickBuildingRef.current = onPickBuilding;
  floorRef.current = floor;
  panelOpenRef.current = panelOpen;
  buildingIdRef.current = buildingId;
  activeRouteRef.current = activeRoute;
  activeLegIndexRef.current = activeLegIndex;
  directionModeRef.current = directionMode;

  useEffect(() => {
    if (!rootRef.current || mapRef.current) return;
    if (!hasWebGL2()) {
      setStatus("This browser cannot draw the map. Open http://localhost:3000 in Chrome or Edge.");
      return;
    }

    const map = new MapLibreMap({
      container: rootRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [-73.9646, 40.7685],
      zoom: 16.6,
      pitch: 56,
      bearing: -29,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true, contextType: "webgl2" },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    mapRef.current = map;

    let cancelled = false;
    const addFloors = async () => {
      if (cancelled || map.getSource("floors")) return;
      try {
        hideBasemapExtrusions(map);
        basemapLayersRef.current = (map.getStyle().layers ?? []).filter((layer) => layer.type !== "fill-extrusion").map(({ id, type }) => ({ id, type }));
        await Promise.all([registerCustomBadges(map), registerRouteMarkerIcons(map)]);
        if (cancelled) return;
        const response = await fetch("/data/hunter-floors.geojson?v=10");
        if (!response.ok) throw new Error(`Could not load floor data (${response.status})`);
        const data = await response.json();
        if (cancelled) return;
        dataRef.current = data.features;
        map.addSource("floors", { type: "geojson", data, promoteId: "id" });
        map.addLayer({
          id: "campus-flat",
          type: "fill",
          source: "floors",
          filter: ["==", ["get", "kind"], "context"],
          paint: {
            "fill-color": "#cbc8c2",
            "fill-opacity": 0.9,
          },
        });
        if (map.getSource("openmaptiles")) {
          map.addLayer({
            id: "context-buildings",
            type: "fill-extrusion",
            source: "openmaptiles",
            "source-layer": "building",
            minzoom: 14,
            filter: ["!", ["in", ["id"], ["literal", BASEMAP_HUNTER_IDS]]],
            paint: {
              "fill-extrusion-color": "#e6e3dd",
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10],
              "fill-extrusion-opacity": 0.5,
              "fill-extrusion-vertical-gradient": true,
            },
          });
        }
        map.addLayer({
          id: "hunter-mass",
          type: "fill-extrusion",
          source: "floors",
          filter: ["==", ["get", "kind"], "mass"],
          paint: {
            "fill-extrusion-color": HUNTER_FACADE,
            "fill-extrusion-base": 0,
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        // A thin pale cap reads as a rooftop and separates the buildings from each other.
        map.addLayer({
          id: "hunter-roofs",
          type: "fill-extrusion",
          source: "floors",
          filter: ["==", ["get", "kind"], "mass"],
          paint: {
            "fill-extrusion-color": "#e2d6f1",
            "fill-extrusion-base": ["get", "height"],
            "fill-extrusion-height": ["+", ["get", "height"], 0.6],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        // Night view: square windows on every facade, each lit or dark (feature-state "level" fades them).
        const masses = (data.features as FloorFeature[]).filter((feature) => feature.properties.kind === "mass") as unknown as MassFeature[];
        const markers = await fetch("/data/campus-markers.geojson?v=11").then((res) => (res.ok ? res.json() : { features: [] })).catch(() => ({ features: [] }));
        const classrooms: Record<string, number> = {};
        for (const { properties: marker } of markers.features as { properties: { category?: string; building: string; level: number } }[]) {
          if (marker.category === "classroom") classrooms[`${marker.building}:${marker.level}`] = (classrooms[`${marker.building}:${marker.level}`] ?? 0) + 1;
        }
        if (cancelled) return;
        const windows = hunterWindows(masses, classrooms);
        windowsRef.current = windows.features;
        map.addSource("hunter-windows", { type: "geojson", data: windows });
        map.addLayer({
          id: "hunter-windows",
          type: "fill-extrusion",
          source: "hunter-windows",
          layout: { visibility: "none" },
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["feature-state", "level"], ["get", "lit"]], 0, "#2a1f45", 1, ["match", ["get", "glow"], "bright", "#ffd98c", "warm", "#ffc977", "#f4b765"]],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "hunter-bridges",
          type: "fill-extrusion",
          source: "floors",
          filter: ["==", ["get", "kind"], "bridge"],
          paint: {
            "fill-extrusion-color": "#5b238a",
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        // See-through neighbors must draw after Hunter's buildings, or they hide them instead of letting them show through.
        if (map.getLayer("context-buildings")) map.moveLayer("context-buildings");
        map.addLayer({
          id: "stacked-podiums",
          type: "fill-extrusion",
          source: "floors",
          filter: stackedPodiumFilter(floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": "#d2d0ca",
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["+", ["get", "base"], STOREY_HEIGHT],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        map.addLayer({
          id: "floor-plate",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("floor", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#e6e6e6"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "hallways",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("hallway", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#cdd6e0"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "rooms",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("room", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": roomColor(null),
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "room-outlines",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("room-outline", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#848994"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "walls",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("wall", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#74777d"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        // Selected room: a pulsing glow slab on top of the room plus a short, faint halo above it.
        map.addLayer({
          id: "room-selected-glow",
          type: "fill-extrusion",
          source: "floors",
          filter: selectedRoomFilter(null, null),
          paint: {
            "fill-extrusion-color": "#34d399",
            "fill-extrusion-base": ["get", "height"],
            "fill-extrusion-height": ["+", ["get", "height"], 0.3],
            "fill-extrusion-opacity": 0.9,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "room-selected-beam",
          type: "fill-extrusion",
          source: "floors",
          filter: selectedRoomFilter(null, null),
          paint: {
            "fill-extrusion-color": "#6ee7b7",
            "fill-extrusion-base": ["+", ["get", "height"], 0.3],
            "fill-extrusion-height": ["+", ["get", "height"], 1.5],
            "fill-extrusion-opacity": 0.25,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        // Room under the mouse: a thin white wash on top brightens it.
        map.addLayer({
          id: "room-hover",
          type: "fill-extrusion",
          source: "floors",
          filter: NO_FEATURE,
          paint: {
            "fill-extrusion-color": "#ffffff",
            "fill-extrusion-base": ["get", "height"],
            "fill-extrusion-height": ["+", ["get", "height"], 0.12],
            "fill-extrusion-opacity": 0.5,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addSource("campus-markers", {
          type: "geojson",
          data: "/data/campus-markers.geojson?v=11",
        });
        map.addLayer({
          id: "campus-room-labels",
          type: "symbol",
          source: "campus-markers",
          filter: ["==", ["get", "level"], floorRef.current ?? 1],
          layout: {
            "symbol-placement": "point",
            "icon-image": ["step", ["zoom"], markerIcon("dot-classroom"), 18.6, markerIcon("badge-classroom")],
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              16, 0.48,
              17.5, 0.65,
              19, 0.85
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "base"], 0.28],
            "text-field": ["get", "displayCode"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              16, 9.5,
              17.5, 11,
              19, 12.5
            ],
            "text-anchor": "left",
            "text-offset": [0.85, 0],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-optional": true,
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
            "text-max-width": 12,
          },
          paint: {
            "text-color": "#1e293b",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });
        const initialRoute = routeToGeoJSON(activeRouteRef.current);
        map.addSource("route-ribbons", {
          type: "geojson",
          data: initialRoute.ribbons,
        });
        map.addSource("route-markers", {
          type: "geojson",
          data: initialRoute.markers,
        });
        map.addLayer({
          id: "route-ribbons",
          type: "fill-extrusion",
          source: "route-ribbons",
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#8b5cf6"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 0.65,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        map.addSource("route-arrows", {
          type: "geojson",
          data: routeArrows(activeRouteRef.current)(0),
        });
        map.addLayer({
          id: "route-arrows",
          type: "fill-extrusion",
          source: "route-arrows",
          paint: {
            "fill-extrusion-color": "#ffffff",
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "route-markers-label",
          type: "symbol",
          source: "route-markers",
          layout: {
            "symbol-placement": "point",
            "icon-image": ["match", ["get", "kind"], "start", "route-start", "route-destination"],
            "icon-size": 0.8,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": [
              "case",
              ["==", ["get", "kind"], "start"],
              ["concat", "Start: ", ["get", "label"]],
              ["==", ["get", "kind"], "destination"],
              ["concat", "End: ", ["get", "label"]],
              ["get", "label"]
            ],
            "text-size": 12,
            "text-anchor": "left",
            "text-offset": [1.25, 0],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "base"], 1.1],
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
          },
          paint: {
            "text-color": [
              "case",
              ["==", ["get", "kind"], "start"], "#065f46",
              ["==", ["get", "kind"], "destination"], "#92400e",
              "#4338ca"
            ],
            "text-halo-color": "#ffffff",
            "text-halo-width": 2.5,
          },
        });
        map.addLayer({
          id: "room-selected-label",
          type: "symbol",
          source: "campus-markers",
          filter: selectedRoomFilter(null, null),
          layout: {
            "symbol-placement": "point",
            "text-field": ["get", "roomId"],
            "text-size": 16,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "base"], 3],
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
          },
          paint: {
            "text-color": "#065f46",
            "text-halo-color": "#ffffff",
            "text-halo-width": 3,
          },
        });
        map.addLayer({
          id: "building-labels",
          type: "symbol",
          source: "floors",
          filter: ["==", ["get", "kind"], "mass"],
          layout: {
            "symbol-placement": "point",
            "text-field": ["get", "name"],
            "text-size": 12,
            "text-max-width": 9,
            "text-allow-overlap": true,
            "text-pitch-alignment": "map",
            "text-rotation-alignment": "map",
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "height"], 1],
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#4b1d72",
            "text-halo-width": 1.25,
          },
        });
        // Street entrances, outdoors only. Accessible ones use the wheelchair badge.
        const entrances = await fetch("/data/campus-entrances.geojson").then((res) => (res.ok ? res.json() : { type: "FeatureCollection", features: [] })).catch(() => ({ type: "FeatureCollection", features: [] }));
        if (cancelled) return;
        map.addSource("campus-entrances", { type: "geojson", data: entrances });
        map.addLayer({
          id: "campus-entrances",
          type: "symbol",
          source: "campus-entrances",
          layout: {
            "icon-image": ["case", ["get", "accessible"], "badge-entrance-accessible", "badge-entrance"],
            "icon-size": 0.9,
            "icon-allow-overlap": true,
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-anchor": "top",
            "text-offset": [0, 1.3],
            "text-max-width": 10,
            "text-optional": true,
          },
          paint: {
            "text-color": "#1e293b",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });
        // Subway entrances, stations and bus stops from OpenStreetMap, outdoors only.
        if (map.getSource("openmaptiles")) {
          map.addSource("transit-link", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({
            id: "transit-link",
            type: "line",
            source: "transit-link",
            layout: { "line-cap": "round" },
            paint: { "line-color": "#5b238a", "line-width": 3, "line-dasharray": [1, 1.5] },
          });
          map.addLayer({
            id: "transit-stops",
            type: "symbol",
            source: "openmaptiles",
            "source-layer": "poi",
            minzoom: 16,
            filter: ["any", ["==", ["get", "subclass"], "subway_entrance"], ["all", ["==", ["get", "class"], "railway"], ["==", ["get", "subclass"], "station"]], ["==", ["get", "subclass"], "bus_stop"]],
            layout: {
              "icon-image": ["case", ["==", ["get", "subclass"], "bus_stop"], "badge-bus", "badge-subway"],
              "icon-size": 0.75,
              "icon-allow-overlap": true,
              "text-field": ["case", ["==", ["get", "subclass"], "station"], ["coalesce", ["get", "name"], ""], ""],
              "text-size": 11,
              "text-anchor": "top",
              "text-offset": [0, 1.2],
              "text-optional": true,
            },
            paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 2 },
          });
          // Tapping a stop links it to the nearest Hunter entrance with a dashed line and a walking time.
          let transitPopup: Popup | null = null;
          map.on("click", "transit-stops", (event) => {
            const stop = event.features?.[0];
            if (!stop || stop.geometry.type !== "Point") return;
            const from = new LngLat(...(stop.geometry.coordinates as [number, number]));
            const nearest = (entrances.features as { geometry: { coordinates: [number, number] }; properties: { name: string } }[])
              .map((entrance) => ({ entrance, meters: from.distanceTo(new LngLat(...entrance.geometry.coordinates)) }))
              .sort((a, b) => a.meters - b.meters)[0];
            const name = String(stop.properties?.name ?? (stop.properties?.subclass === "bus_stop" ? "Bus stop" : "Subway entrance"));
            transitPopup?.remove();
            if (!nearest) return;
            const minutes = Math.max(1, Math.round(edgeSeconds("walk", nearest.meters, 0, 0) / 60));
            (map.getSource("transit-link") as GeoJSONSource).setData({
              type: "Feature",
              geometry: { type: "LineString", coordinates: [from.toArray(), nearest.entrance.geometry.coordinates] },
              properties: {},
            });
            transitPopup = new Popup({ offset: 14, className: "transit-popup", maxWidth: "240px" })
              .setLngLat(from)
              .setText(`${name}: ${Math.round(nearest.meters)} m to ${nearest.entrance.properties.name}, about ${minutes} min walk`)
              .addTo(map);
            transitPopup.on("close", () => (map.getSource("transit-link") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] }));
          });
          map.on("mouseenter", "transit-stops", () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "transit-stops", () => { map.getCanvas().style.cursor = ""; });
        }
        setMode(map, floorRef.current, buildingIdRef.current, directionModeRef.current);
        // Outdoors, tapping one of Hunter's buildings opens its card (stops and entrances on top win).
        for (const layer of ["hunter-mass", "hunter-windows"]) {
          map.on("click", layer, (event) => {
            const onTop = ["transit-stops", "campus-entrances"].filter((id) => map.getLayer(id));
            if (onTop.length && map.queryRenderedFeatures(event.point, { layers: onTop }).length) return;
            const building = String(event.features?.[0]?.properties?.building ?? "");
            if (isCampusBuildingId(building)) onPickBuildingRef.current?.(building);
          });
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }
        map.on("click", "rooms", (event) => {
          const roomId = event.features?.[0]?.properties?.roomId;
          if (roomId) onSelectRoomRef.current(String(roomId));
        });
        map.on("mouseenter", "rooms", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "rooms", () => {
          map.getCanvas().style.cursor = "";
        });
        // Hover highlight and name tooltip, only where there is a real mouse (taps would leave them stuck).
        if (window.matchMedia("(hover: hover)").matches) {
          let hoveredId = "";
          map.on("mousemove", "rooms", (event) => {
            const props = event.features?.[0]?.properties;
            const tooltip = tooltipRef.current;
            if (String(props?.id ?? "") !== hoveredId) {
              hoveredId = String(props?.id ?? "");
              map.setFilter("room-hover", ["==", ["get", "id"], hoveredId]);
              if (tooltip) tooltip.textContent = String(props?.name || props?.roomId || "");
            }
            if (!tooltip) return;
            tooltip.hidden = !tooltip.textContent;
            tooltip.style.transform = `translate(${event.point.x + 14}px, ${event.point.y + 18}px)`;
          });
          map.on("mouseleave", "rooms", () => {
            hoveredId = "";
            map.setFilter("room-hover", NO_FEATURE);
            if (tooltipRef.current) tooltipRef.current.hidden = true;
          });
        }
        map.on("click", "campus-room-labels", (event) => {
          const roomId = event.features?.[0]?.properties?.roomId;
          if (roomId) onSelectRoomRef.current(String(roomId));
        });
        map.on("mouseenter", "campus-room-labels", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "campus-room-labels", () => {
          map.getCanvas().style.cursor = "";
        });
        map.resize();
        await new Promise<void>((resolve) => {
          const onData = (event: { sourceId?: string }) => {
            if (event.sourceId !== "floors" || !map.isSourceLoaded("floors")) return;
            map.off("sourcedata", onData);
            resolve();
          };
          map.on("sourcedata", onData);
        });
        if (cancelled) return;
        setStatus("");
        setReady(true);
        if (rootRef.current) rootRef.current.dataset.ready = "1";
        // A slow sweep onto campus, only on a student's first visit; any drag or zoom stops it.
        let seen = true;
        try {
          seen = localStorage.getItem(INTRO_KEY) === "1";
          localStorage.setItem(INTRO_KEY, "1");
        } catch {
          // Without storage we can't tell a first visit, so skip the intro rather than replay it daily.
        }
        if (!seen && floorRef.current == null && !prefersReducedMotion()) {
          const end = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
          map.jumpTo({ zoom: end.zoom - 1.8, pitch: 30, bearing: end.bearing - 140 });
          map.easeTo({ ...end, duration: 5000, easing: (t) => 1 - (1 - t) ** 3 });
        }
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Could not load campus map");
      }
    };

    map.on("error", (event) => {
      const message = event.error?.message ?? "Map failed to render";
      if (!map.getSource("floors")) setStatus(message);
    });
    map.once("load", () => {
      void addFloors();
    });
    if (map.loaded()) void addFloors();

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(rootRef.current);

    return () => {
      cancelled = true;
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("rooms")) return;
    setMode(map, floor, buildingId, directionMode);
    map.setFilter("room-hover", NO_FEATURE);
    if (tooltipRef.current) tooltipRef.current.hidden = true;
    // Keep the 3D structure legible through the route and nearby rooms.
    const opacities: [layer: string, property: "fill-extrusion-opacity" | "icon-opacity" | "text-opacity", value: number][] = [
      ["floor-plate", "fill-extrusion-opacity", 1],
      ["hallways", "fill-extrusion-opacity", 1],
      ["rooms", "fill-extrusion-opacity", directionMode ? 0.35 : 1],
      ["room-outlines", "fill-extrusion-opacity", 1],
      ["walls", "fill-extrusion-opacity", directionMode ? 0.5 : 1],
      ["campus-room-labels", "icon-opacity", directionMode ? 0.3 : 1],
      ["campus-room-labels", "text-opacity", directionMode ? 0.4 : 1],
    ];
    const present = opacities.filter(([layer]) => map.getLayer(layer));
    const floorChanged = shownFloorRef.current !== floor;
    shownFloorRef.current = floor;
    if (!floorChanged || floor == null || prefersReducedMotion()) {
      for (const [layer, property, value] of present) map.setPaintProperty(layer, property, value);
      return;
    }
    // New floor: start it invisible, then fade it in.
    for (const [layer, property] of present) {
      map.setPaintProperty(layer, `${property}-transition`, { duration: 0, delay: 0 });
      map.setPaintProperty(layer, property, 0);
    }
    const frame = requestAnimationFrame(() => {
      for (const [layer, property, value] of present) {
        map.setPaintProperty(layer, `${property}-transition`, { duration: 280, delay: 0 });
        map.setPaintProperty(layer, property, value);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, floor, buildingId, directionMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLight({ anchor: "map", ...scene.light });
    map.setSky(scene.sky);
    if (map.getLayer("context-buildings")) {
      map.setPaintProperty("context-buildings", "fill-extrusion-color", scene.neighbors);
      map.setPaintProperty("context-buildings", "fill-extrusion-opacity", scene.neighborOpacity);
    }
    map.setPaintProperty("hunter-roofs", "fill-extrusion-color", scene.roof);
    // setMode colors the masses and bridges for the current mode; repaint them for the scene outdoors.
    if (outdoor) {
      // The tapped building is drawn a shade lighter so it stands out as well as rising.
      map.setPaintProperty("hunter-mass", "fill-extrusion-color", ["case", ["==", ["get", "building"], pickedBuilding ?? ""], "#9a6ad6", scene.facade]);
      map.setPaintProperty("hunter-bridges", "fill-extrusion-color", scene.facade);
    }
    map.setLayoutProperty("hunter-windows", "visibility", outdoor && scene.litWindows ? "visible" : "none");
    paintBasemap(map, basemapLayersRef.current, outdoor ? time : "day", outdoor ? weather : "clear", season, basemapOriginalsRef.current);
  }, [ready, scene, outdoor, time, weather, season, buildingId, directionMode, pickedBuilding]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // The tapped building rises a few meters, easing up over about 0.3 s.
    const apply = (lift: number) => {
      const raise = liftFor(pickedBuilding, lift);
      map.setPaintProperty("hunter-mass", "fill-extrusion-base", raise);
      map.setPaintProperty("hunter-mass", "fill-extrusion-height", ["+", ["get", "height"], raise]);
      map.setPaintProperty("hunter-roofs", "fill-extrusion-base", ["+", ["get", "height"], raise]);
      map.setPaintProperty("hunter-roofs", "fill-extrusion-height", ["+", ["get", "height"], 0.6, raise]);
      map.setPaintProperty("hunter-windows", "fill-extrusion-base", ["+", ["get", "base"], raise]);
      map.setPaintProperty("hunter-windows", "fill-extrusion-height", ["+", ["get", "height"], raise]);
    };
    if (!pickedBuilding || prefersReducedMotion()) {
      apply(pickedBuilding ? BUILDING_LIFT_M : 0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const rise = (now: number) => {
      const t = Math.min(1, (now - start) / 300);
      apply(BUILDING_LIFT_M * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(rise);
    };
    frame = requestAnimationFrame(rise);
    return () => cancelAnimationFrame(frame);
  }, [ready, pickedBuilding]);

  useEffect(() => {
    const map = mapRef.current;
    const windows = windowsRef.current;
    if (!ready || !map || !outdoor || !scene.litWindows || !windows.length || prefersReducedMotion()) return;
    // Every 200 ms a few windows decide whether to be lit (busier floors more often) and fade there over ~2.5 s.
    const levels = windows.map((window) => window.properties.lit);
    const fading = new Map<number, number>();
    const timer = window.setInterval(() => {
      for (let i = 0; i < 4; i++) {
        const window = windows[Math.floor(Math.random() * windows.length)];
        const target = Math.random() < LIT_SHARE[window.properties.glow] ? 1 : 0;
        if (target !== levels[window.id] && !fading.has(window.id)) fading.set(window.id, target);
      }
      for (const [id, target] of fading) {
        levels[id] = Math.min(1, Math.max(0, levels[id] + (target ? 0.08 : -0.08)));
        map.setFeatureState({ source: "hunter-windows", id }, { level: levels[id] });
        if (levels[id] === target) fading.delete(id);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [ready, outdoor, scene.litWindows]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("rooms")) return;
    map.setPaintProperty("rooms", "fill-extrusion-color", roomColor(selectedRoom));
    map.setFilter("room-selected-glow", selectedRoomFilter(selectedRoom, floorRef.current));
    map.setFilter("room-selected-beam", selectedRoomFilter(selectedRoom, floorRef.current));
    map.setFilter("room-selected-label", selectedRoomFilter(selectedRoom, floorRef.current));
    if (!selectedRoom || prefersReducedMotion()) return;

    // Pulse only the two single-feature layers, about 30 times a second.
    let frame = 0;
    let last = 0;
    const pulse = (time: number) => {
      frame = requestAnimationFrame(pulse);
      if (time - last < 33) return;
      last = time;
      const wave = (Math.sin(time / 380) + 1) / 2;
      map.setPaintProperty("room-selected-glow", "fill-extrusion-opacity", 0.55 + wave * 0.45);
      map.setPaintProperty("room-selected-beam", "fill-extrusion-opacity", 0.1 + wave * 0.25);
    };
    frame = requestAnimationFrame(pulse);
    return () => cancelAnimationFrame(frame);
  }, [ready, selectedRoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const geojson = routeToGeoJSON(activeRoute);
    const ribbonSource = map.getSource("route-ribbons") as GeoJSONSource | undefined;
    const markerSource = map.getSource("route-markers") as GeoJSONSource | undefined;
    if (ribbonSource) ribbonSource.setData(geojson.ribbons);
    if (markerSource) markerSource.setData(geojson.markers);
  }, [ready, activeRoute]);

  useEffect(() => {
    const source = mapRef.current?.getSource("route-arrows") as GeoJSONSource | undefined;
    if (!ready || !source) return;
    const arrows = routeArrows(activeRoute);
    source.setData(arrows(0));
    if (!activeRoute || prefersReducedMotion()) return;

    // Slide the arrows along the route at walking pace, about 20 updates a second.
    let frame = 0;
    let last = 0;
    const slide = (time: number) => {
      frame = requestAnimationFrame(slide);
      if (time - last < 50) return;
      last = time;
      source.setData(arrows((time / 1000) * 1.4));
    };
    frame = requestAnimationFrame(slide);
    return () => cancelAnimationFrame(frame);
  }, [ready, activeRoute]);

  useEffect(() => {
    const map = mapRef.current;
    // Picking a room brings it into view; route framing below takes over in Directions.
    if (!ready || !map || !selectedRoom || directionMode) return;
    fitRoom(map, dataRef.current, selectedRoom, floorRef.current, panelOpenRef.current);
    return () => { map.stop(); };
  }, [ready, selectedRoom, directionMode]);

  useEffect(() => {
    const map = mapRef.current;
    // Frame the route on this floor as soon as it is found, then each leg once guidance starts.
    if (!ready || !map || !directionMode || !activeRoute) return;
    fitFeatures(
      map,
      dataRef.current,
      floorRef.current,
      buildingIdRef.current,
      panelOpenRef.current,
      activeRoute,
      activeLegIndex,
      directionMode
    );
    // Stop a route animation if the user leaves Directions mid-transition.
    return () => { map.stop(); };
  }, [ready, activeRoute, activeLegIndex, directionMode]);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={rootRef} className="h-full min-h-0 w-full" />
      {outdoor && scene.overlay.length ? <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: scene.overlay.join(", ") }} /> : null}
      {outdoor ? <WeatherLayer weather={weather} night={time === "night"} /> : null}
      {outdoor && ready ? (
        <SceneControl time={time} weather={weather} season={season} onTime={setTime} onWeather={setWeather} onSeason={setSeason} className="absolute bottom-[calc(46dvh+12px)] left-3 z-20 md:bottom-4 md:left-1/2 md:-translate-x-1/2" />
      ) : null}
      <div
        ref={tooltipRef}
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-10 max-w-56 truncate rounded-lg border border-white/60 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-800 shadow-md backdrop-blur-md"
      />
      {status ? (
        <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-[#3f3b36]">
          {status}
        </p>
      ) : null}
    </div>
  );
}
